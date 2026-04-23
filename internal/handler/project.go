package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"dm-inspect/internal/model"
	"dm-inspect/internal/store"

	"github.com/gin-gonic/gin"
)

// latestReportInfo 项目最近巡检信息
type latestReportInfo struct {
	ReportDate   string `json:"report_date,omitempty"`
	Status       string `json:"status,omitempty"`
	Summary      string `json:"summary,omitempty"`
	ErrorMessage string `json:"error_message,omitempty"`
	FailedBlocks string `json:"failed_blocks,omitempty"`
}

// ListProjects 获取项目列表（含最近巡检概览）
func ListProjects(c *gin.Context) {
	rows, err := store.DB.Query(`
		SELECT p.id, p.name, p.template_id, p.variables, p.created_at,
		       t.name as template_name,
		       lr.report_date as latest_report_date,
		       lr.status as latest_report_status,
		       lr.summary as latest_report_summary,
		       lr.error_message as latest_report_error_message,
		       lr.failed_blocks as latest_report_failed_blocks
		FROM projects p
		LEFT JOIN templates t ON p.template_id = t.id
		LEFT JOIN (
			SELECT r1.project_id, r1.report_date, r1.status, r1.summary, r1.error_message, r1.failed_blocks
			FROM reports r1
			INNER JOIN (
				SELECT project_id, MAX(id) as max_id
				FROM reports
				GROUP BY project_id
			) r2 ON r1.project_id = r2.project_id AND r1.id = r2.max_id
		) lr ON lr.project_id = p.id
		ORDER BY p.id DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query projects"})
		return
	}
	defer rows.Close()

	type ProjectWithTemplate struct {
		model.Project
		TemplateName   string            `json:"template_name"`
		LatestReport   *latestReportInfo `json:"latest_report,omitempty"`
	}

	var projects []ProjectWithTemplate
	for rows.Next() {
		var p ProjectWithTemplate
		var latestDate, latestStatus, latestSummary, latestErrorMessage, latestFailedBlocks sql.NullString
		if err := rows.Scan(
			&p.ID, &p.Name, &p.TemplateID, &p.Variables, &p.CreatedAt, &p.TemplateName,
			&latestDate, &latestStatus, &latestSummary, &latestErrorMessage, &latestFailedBlocks,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan project"})
			return
		}
		if latestDate.Valid {
			p.LatestReport = &latestReportInfo{
				ReportDate:   latestDate.String,
				Status:       latestStatus.String,
				Summary:      latestSummary.String,
				ErrorMessage: latestErrorMessage.String,
				FailedBlocks: latestFailedBlocks.String,
			}
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "row iteration error"})
		return
	}

	c.JSON(http.StatusOK, projects)
}

// QuickCreateProject 使用预设快速创建模板和项目
func QuickCreateProject(c *gin.Context) {
	var req struct {
		PresetKey   string `json:"preset_key"`
		ProjectName string `json:"project_name"`
		Group       string `json:"group"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if req.PresetKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "preset_key is required"})
		return
	}
	if req.ProjectName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project_name is required"})
		return
	}
	if req.Group == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写巡检范围标签（group）"})
		return
	}

	// 查找预设
	var preset *presetTemplate
	for idx := range presets {
		if presets[idx].Key == req.PresetKey {
			preset = &presets[idx]
			break
		}
	}
	if preset == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "预设模板不存在"})
		return
	}

	// 事务：创建模板 + 创建项目
	tx, err := store.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to begin transaction"})
		return
	}
	defer tx.Rollback()

	tmplResult, err := tx.Exec(
		"INSERT INTO templates (name, content) VALUES (?, ?)",
		preset.Name, preset.Content,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create template"})
		return
	}
	templateID, _ := tmplResult.LastInsertId()

	variables, _ := json.Marshal(map[string]string{"group": req.Group})
	projResult, err := tx.Exec(
		"INSERT INTO projects (name, template_id, variables) VALUES (?, ?, ?)",
		req.ProjectName, templateID, string(variables),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create project"})
		return
	}
	projectID, _ := projResult.LastInsertId()

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"project_id":    projectID,
		"template_id":   templateID,
		"project_name":  req.ProjectName,
		"template_name": preset.Name,
		"variables":     map[string]string{"group": req.Group},
	})
}

// CreateProject 创建项目
func CreateProject(c *gin.Context) {
	var p model.Project
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if p.Name == "" || p.TemplateID == 0 || p.Variables == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name、template_id 和 variables 为必填字段"})
		return
	}

	result, err := store.DB.Exec(
		"INSERT INTO projects (name, template_id, variables) VALUES (?, ?, ?)",
		p.Name, p.TemplateID, p.Variables,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create project"})
		return
	}

	id, _ := result.LastInsertId()
	p.ID = id
	c.JSON(http.StatusCreated, p)
}

// GetProject 获取项目
func GetProject(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var p model.Project
	err = store.DB.QueryRow(
		"SELECT id, name, template_id, variables, created_at FROM projects WHERE id = ?",
		id,
	).Scan(&p.ID, &p.Name, &p.TemplateID, &p.Variables, &p.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}
	c.JSON(http.StatusOK, p)
}

// UpdateProject 更新项目
func UpdateProject(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var p model.Project
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if p.Name == "" || p.TemplateID == 0 || p.Variables == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name、template_id 和 variables 为必填字段"})
		return
	}

	_, err = store.DB.Exec(
		"UPDATE projects SET name = ?, template_id = ?, variables = ? WHERE id = ?",
		p.Name, p.TemplateID, p.Variables, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update project"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

// DeleteProject 删除项目（依赖 SQLite 外键 ON DELETE CASCADE 自动级联删除 reports）
func DeleteProject(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	if _, err = store.DB.Exec("DELETE FROM projects WHERE id = ?", id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete project"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}
