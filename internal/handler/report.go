package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"dm-inspect/internal/model"
	"dm-inspect/internal/service"
	"dm-inspect/internal/store"

	"github.com/gin-gonic/gin"
)

// ListReports 获取报告列表（支持分页）
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

	// 分页参数
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 10
	}
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	// 构建 WHERE 条件
	where := "WHERE 1=1"
	args := []interface{}{}

	if projectID != "" {
		where += " AND r.project_id = ?"
		args = append(args, projectID)
	}
	if date != "" {
		where += " AND r.report_date = ?"
		args = append(args, date)
	}
	if status != "" {
		where += " AND r.status = ?"
		args = append(args, status)
	}

	// 查询总数
	var total int
	countQuery := "SELECT COUNT(*) FROM reports r " + where
	if err := store.DB.QueryRow(countQuery, args...).Scan(&total); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count reports"})
		return
	}

	// 查询列表
	query := `
		SELECT r.id, r.project_id, r.report_date, r.data, r.status, r.created_at,
		       r.error_message, r.failed_blocks, r.warnings, r.summary,
		       p.name as project_name
		FROM reports r
		LEFT JOIN projects p ON r.project_id = p.id
	` + where + " ORDER BY r.id DESC LIMIT ? OFFSET ?"
	queryArgs := append(args, pageSize, offset)

	rows, err := store.DB.Query(query, queryArgs...)
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

	c.JSON(http.StatusOK, gin.H{
		"list":  reports,
		"total": total,
	})
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

	md := service.GenerateMarkdown(r.ProjectName, group, r.ReportDate, r.Status, r.ErrorMessage, r.FailedBlocks, r.Warnings, r.Summary, r.BlockResults, reportData)
	c.Header("Content-Type", "text/markdown; charset=utf-8")
	c.String(http.StatusOK, md)
}

