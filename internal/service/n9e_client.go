package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"dm-inspect/internal/model"
)

// N9EClient Nightingale 告警客户端
type N9EClient struct {
	endpoint string
	username string
	password string
	token    string
	tokenExp time.Time
	client   *http.Client
	mu       sync.Mutex // 保护 token/tokenExp 的并发读写
}

// NewN9EClient 创建 N9E 客户端
func NewN9EClient(endpoint, username, password string) *N9EClient {
	return &N9EClient{
		endpoint: endpoint,
		username: username,
		password: password,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// EnsureToken 确保 token 有效，支持 context 取消
func (c *N9EClient) EnsureToken(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Now().Before(c.tokenExp) {
		return nil
	}
	return c.login(ctx)
}

func (c *N9EClient) login(ctx context.Context) error {
	body, err := json.Marshal(map[string]any{
		"username": c.username,
		"password": c.password,
		"is_ldap":  0,
	})
	if err != nil {
		return fmt.Errorf("marshal login body failed: %w", err)
	}

	url := c.endpoint + "/api/n9e/auth/login"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build N9E login request failed: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("N9E login request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
	if err != nil {
		return fmt.Errorf("read N9E login response failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("N9E login returned status %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Err string `json:"err"`
		Dat struct {
			AccessToken string `json:"access_token"`
		} `json:"dat"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return fmt.Errorf("decode N9E login response failed: %w", err)
	}
	if result.Err != "" {
		return fmt.Errorf("N9E login failed: %s", result.Err)
	}
	if result.Dat.AccessToken == "" {
		return fmt.Errorf("N9E login response missing access_token")
	}

	c.token = result.Dat.AccessToken
	c.tokenExp = time.Now().Add(24 * time.Hour)
	log.Printf("[N9E] login success, token acquired")
	return nil
}

// GetAlertEvents 获取告警事件列表
func (c *N9EClient) GetAlertEvents(ctx context.Context, stime, etime int64, groupTag string) ([]model.AlertResult, error) {
	if err := c.EnsureToken(ctx); err != nil {
		return nil, err
	}

	var allAlerts []model.AlertResult
	page := 1
	limit := 1000
	const maxPages = 100

	for {
		if page > maxPages {
			log.Printf("[N9E] 已达到最大分页数 %d，停止拉取", maxPages)
			break
		}
		url := fmt.Sprintf("%s/api/n9e/alert-his-events/list?p=%d&limit=%d&stime=%d&etime=%d",
			c.endpoint, page, limit, stime, etime)

		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+c.token)

		resp, err := c.client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("N9E request failed: %w", err)
		}
		respBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read N9E response body failed: %w", readErr)
		}

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("N9E returned status %d: %s", resp.StatusCode, string(respBody))
		}

		var result n9eAlertResponse
		if err := json.Unmarshal(respBody, &result); err != nil {
			return nil, fmt.Errorf("decode N9E response failed: %w", err)
		}
		if result.Err != "" {
			return nil, fmt.Errorf("N9E API error: %s", result.Err)
		}

		// 过滤并收集告警
		for _, alert := range result.Data.List {
			if !containsGroupTag(alert.Tags, groupTag) {
				continue
			}
			allAlerts = append(allAlerts, alert)
		}

		if page >= result.Data.TotalPage {
			break
		}
		page++
	}

	return allAlerts, nil
}

func containsGroupTag(tags, targetGroup string) bool {
	// tags 格式: "group=kuvera-prod,hostname=xxx"
	// 使用精确匹配，避免 "prod" 错误匹配 "group=staging-prod"
	tagList := strings.Split(tags, ",")
	for _, tag := range tagList {
		if strings.TrimSpace(tag) == "group="+targetGroup {
			return true
		}
	}
	return false
}

type n9eAlertResponse struct {
	Err  string `json:"err"`
	Data struct {
		TotalPage int                 `json:"totalPage"`
		List      []model.AlertResult `json:"datas"`
	} `json:"dat"`
}

// GetTargets 获取指定 group 下的服务器列表（分页自动汇聚）
func (c *N9EClient) GetTargets(ctx context.Context, group string) ([]model.TargetInfo, error) {
	if err := c.EnsureToken(ctx); err != nil {
		return nil, err
	}

	var all []model.TargetInfo
	page := 1
	limit := 50

	for {
		url := fmt.Sprintf("%s/api/n9e/targets?query=group%%3D%s&limit=%d&p=%d",
			c.endpoint, group, limit, page)

		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+c.token)

		resp, err := c.client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("N9E targets request failed: %w", err)
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read N9E targets response failed: %w", readErr)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("N9E targets returned status %d: %s", resp.StatusCode, string(body))
		}

		var result n9eTargetsResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("decode N9E targets response failed: %w", err)
		}
		if result.Err != "" {
			return nil, fmt.Errorf("N9E targets API error: %s", result.Err)
		}

		for _, t := range result.Data.List {
			all = append(all, model.TargetInfo{
				Ident:        t.Ident,
				HostIP:       t.HostIP,
				OS:           t.OS,
				CPUNum:       t.CPUNum,
				CPUUtil:      t.CPUUtil,
				MemUtil:      t.MemUtil,
				Offset:       t.Offset,
				Online:       t.TargetUp >= 1,
				AgentVersion: t.AgentVersion,
			})
		}

		if len(all) >= result.Data.Total || len(result.Data.List) == 0 {
			break
		}
		page++
	}

	return all, nil
}

// n9eTarget N9E targets API 单条记录
type n9eTarget struct {
	Ident        string  `json:"ident"`
	HostIP       string  `json:"host_ip"`
	OS           string  `json:"os"`
	CPUNum       int     `json:"cpu_num"`
	CPUUtil      float64 `json:"cpu_util"`
	MemUtil      float64 `json:"mem_util"`
	Offset       int64   `json:"offset"`
	TargetUp     int     `json:"target_up"`
	AgentVersion string  `json:"agent_version"`
}

type n9eTargetsResponse struct {
	Err  string `json:"err"`
	Data struct {
		List  []n9eTarget `json:"list"`
		Total int         `json:"total"`
	} `json:"dat"`
}
