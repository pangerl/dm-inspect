package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"dm-inspect/internal/model"
	"dm-inspect/internal/service"
	"dm-inspect/internal/store"

	"github.com/gin-gonic/gin"
)

// ListReports 获取报告列表
func ListReports(c *gin.Context) {
	projectID := c.Query("project_id")
	date := c.Query("date")
	status := c.Query("status")

	// 参数验证：project_id 必须为有效整数
	if projectID != "" {
		if _, err := strconv.Atoi(projectID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project_id"})
			return
		}
	}

	query := `
		SELECT r.id, r.project_id, r.report_date, r.data, r.status, r.created_at,
		       r.error_message, r.failed_blocks, r.warnings, r.summary,
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
	if status != "" {
		query += " AND r.status = ?"
		args = append(args, status)
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
		if err := rows.Scan(
			&r.ID, &r.ProjectID, &r.ReportDate, &r.Data, &r.Status, &r.CreatedAt,
			&r.ErrorMessage, &r.FailedBlocks, &r.Warnings, &r.Summary,
			&r.ProjectName,
		); err != nil {
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

// GetReport 获取报告详情（含运行时组装的重点关注和建议）
func GetReport(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	type ReportWithProject struct {
		model.Report
		ProjectName string `json:"project_name"`
	}
	var r ReportWithProject
	err = store.DB.QueryRow(`
		SELECT r.id, r.project_id, r.report_date, r.data, r.status, r.created_at,
		       r.error_message, r.failed_blocks, r.warnings, r.summary, r.block_results,
		       p.name as project_name
		FROM reports r
		LEFT JOIN projects p ON r.project_id = p.id
		WHERE r.id = ?
	`, id).Scan(
		&r.ID, &r.ProjectID, &r.ReportDate, &r.Data, &r.Status, &r.CreatedAt,
		&r.ErrorMessage, &r.FailedBlocks, &r.Warnings, &r.Summary, &r.BlockResults,
		&r.ProjectName,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "report not found"})
		return
	}

	// 运行时组装 highlights 和 suggestions（基于 data 动态生成）
	var reportData model.ReportData
	if err := json.Unmarshal([]byte(r.Data), &reportData); err == nil {
		summary := service.BuildSummary(reportData)
		highlights := service.BuildHighlights(reportData)
		suggestions := service.BuildSuggestions(summary)
		highlightsJSON, _ := json.Marshal(highlights)
		suggestionsJSON, _ := json.Marshal(suggestions)
		r.Highlights = string(highlightsJSON)
		r.Suggestions = string(suggestionsJSON)
	}

	c.JSON(http.StatusOK, r)
}

// GetReportMarkdown 获取 Markdown 格式报告（顶部含执行状态和摘要）
func GetReportMarkdown(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	type reportWithProject struct {
		model.Report
		ProjectName string
	}

	var r reportWithProject
	err = store.DB.QueryRow(`
		SELECT r.id, r.project_id, r.report_date, r.data, r.status, r.error_message,
		       r.failed_blocks, r.warnings, r.summary, r.block_results,
		       p.name as project_name
		FROM reports r
		LEFT JOIN projects p ON r.project_id = p.id
		WHERE r.id = ?
	`, id).Scan(
		&r.ID, &r.ProjectID, &r.ReportDate, &r.Data, &r.Status, &r.ErrorMessage,
		&r.FailedBlocks, &r.Warnings, &r.Summary, &r.BlockResults,
		&r.ProjectName,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "report not found"})
		return
	}

	var reportData model.ReportData
	if err := json.Unmarshal([]byte(r.Data), &reportData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse report data"})
		return
	}

	// 获取项目 group 变量（查询失败时降级为空值，报告仍可生成）
	var variables string
	if err := store.DB.QueryRow("SELECT variables FROM projects WHERE id = ?", r.ProjectID).Scan(&variables); err != nil {
		log.Printf("[report] warn: failed to load project variables for project_id=%d: %v", r.ProjectID, err)
	}
	varsMap := make(map[string]string)
	if variables != "" {
		if err := json.Unmarshal([]byte(variables), &varsMap); err != nil {
			log.Printf("[report] warn: failed to parse project variables for project_id=%d: %v", r.ProjectID, err)
		}
	}
	group := varsMap["group"]

	md := generateMarkdown(r.ProjectName, group, r.ReportDate, r.Status, r.ErrorMessage, r.FailedBlocks, r.Warnings, r.Summary, r.BlockResults, reportData)
	c.Header("Content-Type", "text/markdown; charset=utf-8")
	c.String(http.StatusOK, md)
}

func generateMarkdown(projectName, group, reportDate, status, errorMessage, failedBlocksJSON, warningsJSON, summaryJSON, blockResultsJSON string, data model.ReportData) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("# 巡检报告 - %s\n\n", projectName))
	sb.WriteString(fmt.Sprintf("**巡检日期**: %s  \n", reportDate))
	sb.WriteString(fmt.Sprintf("**巡检范围**: group=%s  \n", group))

	// ── 执行状态与摘要 ──────────────────────────────────────────
	statusLabel := map[string]string{"pending": "进行中", "completed": "已完成", "partial": "部分完成", "error": "失败"}
	sb.WriteString(fmt.Sprintf("**执行状态**: %s\n\n", statusLabel[status]))

	if status == "partial" || status == "error" {
		if errorMessage != "" {
			sb.WriteString(fmt.Sprintf("**错误信息**: %s\n\n", errorMessage))
		}
		var failedBlocks []string
		json.Unmarshal([]byte(failedBlocksJSON), &failedBlocks)
		if len(failedBlocks) > 0 {
			sb.WriteString(fmt.Sprintf("**失败区块**: %s\n\n", strings.Join(failedBlocks, ", ")))
		}
	}

	var warnings []string
	json.Unmarshal([]byte(warningsJSON), &warnings)
	if len(warnings) > 0 {
		sb.WriteString("**警告**:\n")
		for _, w := range warnings {
			sb.WriteString(fmt.Sprintf("- %s\n", w))
		}
		sb.WriteString("\n")
	}

	var summary model.Summary
	if err := json.Unmarshal([]byte(summaryJSON), &summary); err == nil {
		sb.WriteString("**异常摘要**:\n")
		sb.WriteString(fmt.Sprintf("- 离线服务器: %d\n", summary.OfflineServers))
		sb.WriteString(fmt.Sprintf("- 时间偏移异常: %d\n", summary.ClockOffsetIssues))
		sb.WriteString(fmt.Sprintf("- 磁盘风险: %d\n", summary.DiskCritical))
		sb.WriteString(fmt.Sprintf("- 中间件异常: %d\n", summary.MiddlewareAbnormal))
		sb.WriteString(fmt.Sprintf("- 告警 S1/S2/S3: %d/%d/%d\n", summary.AlertS1, summary.AlertS2, summary.AlertS3))
		sb.WriteString("\n")
	}

	suggestions := service.BuildSuggestions(&summary)
	if len(suggestions) > 0 {
		sb.WriteString("**建议动作**:\n")
		for _, s := range suggestions {
			sb.WriteString(fmt.Sprintf("- %s\n", s))
		}
		sb.WriteString("\n")
	}

	sb.WriteString("---\n\n")

	// ── 一、服务器概览 ──────────────────────────────────────────
	// 预先按 ident 建立磁盘数据索引（VM instance 可能带端口，取前缀匹配）
	diskByIdent := buildDiskIndex(data.Resources)
	// 收集所有出现的磁盘路径（有序），作为动态列头
	diskPaths := collectDiskPaths(data.Resources)

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

		// 动态生成表头（磁盘列根据实际配置路径生成）
		sb.WriteString("| IP | 状态 | CPU核数 | CPU使用率 | 内存使用率 | 时间偏移")
		for _, p := range diskPaths {
			sb.WriteString(fmt.Sprintf(" | 磁盘(%s)", p))
		}
		sb.WriteString(" |\n")
		sb.WriteString("|-----|------|---------|-----------|------------|----------")
		for range diskPaths {
			sb.WriteString("|----------")
		}
		sb.WriteString("|\n")

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
			sb.WriteString(fmt.Sprintf("| %s | %s | %d | %.1f%% | %.1f%% | %s",
				s.Ident, status, s.CPUNum, s.CPUUtil, s.MemUtil, offsetStr))
			for _, p := range diskPaths {
				val := "N/A"
				if disks, ok := diskByIdent[s.Ident]; ok {
					if v, ok := disks[p]; ok {
						val = fmt.Sprintf("%.1f%%", v)
					}
				}
				sb.WriteString(fmt.Sprintf(" | %s", val))
			}
			sb.WriteString(" |\n")
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

// collectDiskPaths 从 resources 中收集所有出现的磁盘路径（有序，去重）
func collectDiskPaths(resources []model.ServerResource) []string {
	seen := make(map[string]struct{})
	var paths []string
	for _, r := range resources {
		for _, d := range r.Disks {
			if _, exists := seen[d.Path]; !exists {
				seen[d.Path] = struct{}{}
				paths = append(paths, d.Path)
			}
		}
	}
	sort.Strings(paths)
	return paths
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
