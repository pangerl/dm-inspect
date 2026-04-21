package handler

import (
	"net/http"

	"dm-inspect/internal/model"
	"dm-inspect/internal/store"

	"github.com/gin-gonic/gin"
)

// ListProjects 获取项目列表
func ListProjects(c *gin.Context) {
	rows, err := store.DB.Query(`
		SELECT p.id, p.name, p.template_id, p.variables, p.created_at,
		       t.name as template_name
		FROM projects p
		LEFT JOIN templates t ON p.template_id = t.id
		ORDER BY p.id DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query projects"})
		return
	}
	defer rows.Close()

	type ProjectWithTemplate struct {
		model.Project
		TemplateName string `json:"template_name"`
	}

	var projects []ProjectWithTemplate
	for rows.Next() {
		var p ProjectWithTemplate
		if err := rows.Scan(&p.ID, &p.Name, &p.TemplateID, &p.Variables, &p.CreatedAt, &p.TemplateName); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan project"})
			return
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "row iteration error"})
		return
	}

	c.JSON(http.StatusOK, projects)
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
	id := c.Param("id")
	var p model.Project
	err := store.DB.QueryRow(
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
	id := c.Param("id")
	var p model.Project
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	_, err := store.DB.Exec(
		"UPDATE projects SET name = ?, template_id = ?, variables = ? WHERE id = ?",
		p.Name, p.TemplateID, p.Variables, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update project"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

// DeleteProject 删除项目（级联删除 reports）
func DeleteProject(c *gin.Context) {
	id := c.Param("id")

	// 先删除关联的 reports（因为 SQLite 外键 ON DELETE CASCADE 可能不生效）
	_, err := store.DB.Exec("DELETE FROM reports WHERE project_id = ?", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete project reports"})
		return
	}

	_, err = store.DB.Exec("DELETE FROM projects WHERE id = ?", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete project"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}
