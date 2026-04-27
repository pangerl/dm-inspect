package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// VMClient VictoriaMetrics 查询客户端
type VMClient struct {
	endpoint string
	client   *http.Client
}

// NewVMClient 创建 VM 客户端
func NewVMClient(endpoint string) *VMClient {
	return &VMClient{
		endpoint: endpoint,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// SeriesPoint 单条时间序列的统计值
type SeriesPoint struct {
	Labels  map[string]string
	Current float64 // 最后一个有效采样点（当前值）
	Max     float64
	Avg     float64
}

// InstantPoint 瞬时查询结果
type InstantPoint struct {
	Labels map[string]string
	Value  float64
}

// vmQueryResponse 通用 VM 响应结构
type vmQueryResponse struct {
	Status string `json:"status"`
	Error  string `json:"error"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string `json:"metric"`
			Values [][]interface{}   `json:"values"` // query_range 用
			Value  []interface{}     `json:"value"`  // query 用
		} `json:"result"`
	} `json:"data"`
}

// QueryRange 范围查询，返回各 series 的统计摘要（当前值/最大值/平均值）
func (c *VMClient) QueryRange(ctx context.Context, query string, start, end, step int64) ([]SeriesPoint, error) {
	encodedQuery := url.QueryEscape(query)
	vmURL := fmt.Sprintf("%s/api/v1/query_range?query=%s&start=%d&end=%d&step=%d",
		c.endpoint, encodedQuery, start, end, step)

	log.Printf("[VM] query_range: %s", query)

	result, err := c.doQuery(ctx, vmURL)
	if err != nil {
		return nil, err
	}

	var points []SeriesPoint
	for _, series := range result.Data.Result {
		if len(series.Values) == 0 {
			continue
		}
		var sum, max, current float64
		var count int
		for _, v := range series.Values {
			val, ok := parseValue(v)
			if !ok {
				continue
			}
			count++
			sum += val
			current = val
			if val > max {
				max = val
			}
		}
		if count == 0 {
			continue
		}
		points = append(points, SeriesPoint{
			Labels:  series.Metric,
			Current: current,
			Max:     max,
			Avg:     sum / float64(count),
		})
	}
	return points, nil
}

// QueryInstant 瞬时查询，返回当前时刻各 series 的值
func (c *VMClient) QueryInstant(ctx context.Context, query string, ts int64) ([]InstantPoint, error) {
	encodedQuery := url.QueryEscape(query)
	vmURL := fmt.Sprintf("%s/api/v1/query?query=%s&time=%d",
		c.endpoint, encodedQuery, ts)

	log.Printf("[VM] query_instant: %s", query)

	result, err := c.doQuery(ctx, vmURL)
	if err != nil {
		return nil, err
	}

	var points []InstantPoint
	for _, series := range result.Data.Result {
		if len(series.Value) < 2 {
			continue
		}
		val, ok := parseValue(series.Value)
		if !ok {
			continue
		}
		points = append(points, InstantPoint{
			Labels: series.Metric,
			Value:  val,
		})
	}
	return points, nil
}

func (c *VMClient) doQuery(ctx context.Context, vmURL string) (*vmQueryResponse, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", vmURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("VM request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
		return nil, fmt.Errorf("VM returned status %d: %s", resp.StatusCode, string(body))
	}

	var result vmQueryResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode VM response: %w", err)
	}
	if result.Status != "success" {
		return nil, fmt.Errorf("VM query failed: %s", result.Error)
	}
	// log.Printf("[VM] response series count: %d", len(result.Data.Result))
	// for i, s := range result.Data.Result {
	// 	log.Printf("[VM] series %d labels: %v", i, s.Metric)
	// }
	return &result, nil
}

// parseValue 从 VM 返回的 [timestamp, value] 对中解析 float64
func parseValue(v []interface{}) (float64, bool) {
	if len(v) < 2 {
		return 0, false
	}
	switch raw := v[1].(type) {
	case float64:
		return raw, true
	case string:
		val, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return 0, false
		}
		return val, true
	}
	return 0, false
}

// InstanceLabel 从 labels 中提取机器标识（优先 ident，其次 instance/host）
// N9E 环境使用 ident 标签标识机器，instance 标签可能包含端口后缀（如 :9100）
func InstanceLabel(labels map[string]string) string {
	if v := labels["ident"]; v != "" {
		return v
	}
	if v := labels["instance"]; v != "" {
		return v
	}
	return labels["host"]
}
