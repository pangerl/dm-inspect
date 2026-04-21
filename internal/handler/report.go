package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"dm-inspect/internal/model"
	"dm-inspect/internal/store"

	"github.com/gin-gonic/gin"
)

// ListReports 获取报告列表
func ListReports(c *gin.Context) {
	projectID := c.Query("project_id")
	date := c.Query("date")

	// 参数验证：project_id 必须为有效整数
	if projectID != "" {
		if _, err := strconv.Atoi(projectID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project_id"})
			return
		}
	}

	query := `
		SELECT r.id, r.project_id, r.report_date, r.data, r.status, r.created_at,
		       p.name as project_name
		FROM reports r
		LEFT JOIN projects p ON r.project_id = p.id
		WHERE 1=1
	`
	args := []interface{}{}

	if projectID != "" {
		query += " AND r.project_id = ?"
		args = append(args, projectID)
	}
	if date != "" {
		query += " AND r.report_date = ?"
		args = append(args, date)
	}

	query += " ORDER BY r.id DESC"

	rows, err := store.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query reports"})
		return
	}
	defer rows.Close()

	type ReportWithProject struct {
		model.Report
		ProjectName string `json:"project_name"`
	}

	var reports []ReportWithProject
	for rows.Next() {
		var r ReportWithProject
		if err := rows.Scan(&r.ID, &r.ProjectID, &r.ReportDate, &r.Data, &r.Status, &r.CreatedAt, &r.ProjectName); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan report"})
			return
		}
		reports = append(reports, r)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "row iteration error"})
		return
	}

	c.JSON(http.StatusOK, reports)
}

// GetReport 获取报告详情
func GetReport(c *gin.Context) {
	id := c.Param("id")
	var r model.Report
	err := store.DB.QueryRow(
		"SELECT id, project_id, report_date, data, status, created_at FROM reports WHERE id = ?",
		id,
	).Scan(&r.ID, &r.ProjectID, &r.ReportDate, &r.Data, &r.Status, &r.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "report not found"})
		return
	}
	c.JSON(http.StatusOK, r)
}

// GetReportMarkdown 获取 Markdown 格式报告
func GetReportMarkdown(c *gin.Context) {
	id := c.Param("id")

	type reportWithProject struct {
		model.Report
		ProjectName string
	}

	var r reportWithProject
	err := store.DB.QueryRow(
		"SELECT r.id, r.project_id, r.report_date, r.data, r.status, p.name as project_name "+
			"FROM reports r LEFT JOIN projects p ON r.project_id = p.id WHERE r.id = ?",
		id,
	).Scan(&r.ID, &r.ProjectID, &r.ReportDate, &r.Data, &r.Status, &r.ProjectName)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "report not found"})
		return
	}

	var reportData model.ReportData
	if err := json.Unmarshal([]byte(r.Data), &reportData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse report data"})
		return
	}

	// 获取项目 group 变量
	var variables string
	store.DB.QueryRow("SELECT variables FROM projects WHERE id = ?", r.ProjectID).Scan(&variables)
	varsMap := make(map[string]string)
	json.Unmarshal([]byte(variables), &varsMap) //nolint:errcheck
	group := varsMap["group"]

	md := generateMarkdown(r.ProjectName, group, r.ReportDate, reportData)
	c.Header("Content-Type", "text/markdown; charset=utf-8")
	c.String(http.StatusOK, md)
}

func generateMarkdown(projectName, group, reportDate string, data model.ReportData) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("# 巡检报告 - %s\n\n", projectName))
	sb.WriteString(fmt.Sprintf("**巡检日期**: %s  \n", reportDate))
	sb.WriteString(fmt.Sprintf("**巡检范围**: group=%s\n\n", group))

	// ── 一、服务器概览 ──────────────────────────────────────────
	// 预先按 ident 建立磁盘数据索引（VM instance 可能带端口，取前缀匹配）
	diskByIdent := buildDiskIndex(data.Resources)

	sb.WriteString("## 一、服务器概览\n\n")
	if len(data.Servers) == 0 {
		sb.WriteString("暂无服务器数据\n\n")
	} else {
		onlineCount := 0
		for _, s := range data.Servers {
			if s.Online {
				onlineCount++
			}
		}
		sb.WriteString(fmt.Sprintf("**在线**: %d  **离线**: %d  **合计**: %d\n\n",
			onlineCount, len(data.Servers)-onlineCount, len(data.Servers)))
		sb.WriteString("| IP | 状态 | CPU核数 | CPU使用率 | 内存使用率 | 时间偏移 | 系统盘(/) | 数据盘(/data) |\n")
		sb.WriteString("|-----|------|---------|-----------|------------|----------|-----------|---------------|\n")
		for _, s := range data.Servers {
			status := "✅ 在线"
			if !s.Online {
				status = "❌ 离线"
			}
			// 时间偏移绝对值 > 1000ms 标注警告
			offsetStr := fmt.Sprintf("%dms", s.Offset)
			if s.Offset > 1000 || s.Offset < -1000 {
				offsetStr = fmt.Sprintf("⚠️ %dms", s.Offset)
			}
			rootDisk, dataDisk := "N/A", "N/A"
			if disks, ok := diskByIdent[s.Ident]; ok {
				if v, ok := disks["/"]; ok {
					rootDisk = fmt.Sprintf("%.1f%%", v)
				}
				if v, ok := disks["/data"]; ok {
					dataDisk = fmt.Sprintf("%.1f%%", v)
				}
			}
			sb.WriteString(fmt.Sprintf("| %s | %s | %d | %.1f%% | %.1f%% | %s | %s | %s |\n",
				s.Ident, status, s.CPUNum,
				s.CPUUtil, s.MemUtil,
				offsetStr, rootDisk, dataDisk))
		}
		sb.WriteString("\n")
	}

	// ── 二、中间件监控 ──────────────────────────────────────────
	sb.WriteString("## 二、中间件监控\n\n")
	if len(data.Middlewares) == 0 {
		sb.WriteString("暂无中间件数据\n\n")
	} else {
		// 按类型分组输出
		byType := make(map[string][]model.MiddlewareStatus)
		var typeOrder []string
		for _, mw := range data.Middlewares {
			if _, exists := byType[mw.Type]; !exists {
				typeOrder = append(typeOrder, mw.Type)
			}
			byType[mw.Type] = append(byType[mw.Type], mw)
		}

		for _, t := range typeOrder {
			mws := byType[t]
			sb.WriteString(fmt.Sprintf("### %s\n\n", strings.ToUpper(t)))

			// 收集所有出现的 extra metric key
			metricKeys := collectMetricKeys(mws)

			sb.WriteString("| 实例 | 状态")
			for _, k := range metricKeys {
				sb.WriteString(fmt.Sprintf(" | %s", k))
			}
			sb.WriteString(" |\n")

			sb.WriteString("|------|------")
			for range metricKeys {
				sb.WriteString("|------")
			}
			sb.WriteString("|\n")

			for _, mw := range mws {
				status := "✅ 在线"
				if !mw.Online {
					status = "❌ 离线"
				}
				sb.WriteString(fmt.Sprintf("| %s | %s", mw.Instance, status))
				for _, k := range metricKeys {
					v := mw.Metrics[k]
					if v == "" {
						v = "-"
					}
					sb.WriteString(fmt.Sprintf(" | %s", v))
				}
				sb.WriteString(" |\n")
			}
			sb.WriteString("\n")
		}
	}

	// ── 三、容器运行情况 ────────────────────────────────────────
	sb.WriteString("## 三、容器运行情况\n\n")
	if len(data.Containers) == 0 {
		sb.WriteString("暂无容器数据\n\n")
	} else {
		totalRunning := 0
		for _, c := range data.Containers {
			totalRunning += c.RunningCount
		}
		sb.WriteString(fmt.Sprintf("**运行中容器总数**: %d\n\n", totalRunning))
		sb.WriteString("| 服务器 | 运行中容器数 |\n")
		sb.WriteString("|--------|-------------|\n")
		for _, c := range data.Containers {
			sb.WriteString(fmt.Sprintf("| %s | %d |\n", c.Instance, c.RunningCount))
		}
		sb.WriteString("\n")
	}

	// ── 四、告警信息 ────────────────────────────────────────────
	s1, s2, s3 := 0, 0, 0
	for _, a := range data.Alerts {
		switch a.Severity {
		case 1:
			s1++
		case 2:
			s2++
		case 3:
			s3++
		}
	}

	sb.WriteString("## 四、告警信息\n\n")
	sb.WriteString(fmt.Sprintf("**告警总数**: %d　**S1严重**: %d　**S2警告**: %d　**S3提示**: %d\n\n",
		len(data.Alerts), s1, s2, s3))

	if len(data.Alerts) == 0 {
		sb.WriteString("✅ 本次巡检周期内无告警\n\n")
	} else {
		sb.WriteString("| 规则 | 级别 | 目标 | 触发时间 | 状态 |\n")
		sb.WriteString("|------|------|------|----------|------|\n")
		for _, a := range data.Alerts {
			recovered := "未恢复"
			if a.IsRecovered {
				recovered = "已恢复"
			}
			sb.WriteString(fmt.Sprintf("| %s | S%d | %s | %s | %s |\n",
				a.RuleName, a.Severity, a.TargetIdent, a.TriggerTime, recovered))
		}
		sb.WriteString("\n")
	}

	sb.WriteString(fmt.Sprintf("---\n*报告生成时间: %s*\n", time.Now().Format("2006-01-02 15:04:05")))
	return sb.String()
}

// buildDiskIndex 从 resources 构建 ident→path→current 索引。
// VM instance 标签可能带端口（如 "172.0.0.1:9100"），取冒号前的 IP 部分做 key。
func buildDiskIndex(resources []model.ServerResource) map[string]map[string]float64 {
	idx := make(map[string]map[string]float64)
	for _, r := range resources {
		// 提取不含端口的 IP
		ip := r.Instance
		if i := strings.Index(ip, ":"); i != -1 {
			ip = ip[:i]
		}
		if idx[ip] == nil {
			idx[ip] = make(map[string]float64)
		}
		for _, d := range r.Disks {
			idx[ip][d.Path] = d.Current
		}
	}
	return idx
}

// collectMetricKeys 收集中间件列表中所有出现的 extra metric key（有序）
func collectMetricKeys(mws []model.MiddlewareStatus) []string {
	seen := make(map[string]struct{})
	var keys []string
	for _, mw := range mws {
		for k := range mw.Metrics {
			if _, exists := seen[k]; !exists {
				seen[k] = struct{}{}
				keys = append(keys, k)
			}
		}
	}
	return keys
}
