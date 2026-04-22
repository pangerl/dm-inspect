package handler

import (
	"net/http"
	"strings"

	"dm-inspect/internal/model"
	"dm-inspect/internal/service"
	"dm-inspect/internal/store"

	"github.com/goccy/go-yaml"
	"github.com/gin-gonic/gin"
)

// presetTemplate 预设模板定义
type presetTemplate struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
}

// presets 内置预设模板列表
var presets = []presetTemplate{
	{
		Key:         "standard_linux",
		Name:        "标准 Linux 服务器",
		Description: "适用于通用 Linux 服务器：CPU / 内存 / 系统盘 / 数据盘，无中间件",
		Content: strings.TrimSpace(`
# 资源使用率
resources:
  cpu_query: "avg by(ident) (cpu_usage_active{cpu='cpu-total',group='{{.group}}'})"
  mem_query: "avg by(ident) (mem_used_percent{group='{{.group}}'})"
  disk_queries:
    - path: "/"
      query: "avg by(ident) (disk_used_percent{path='/',group='{{.group}}'})"
    - path: "/data"
      query: "avg by(ident) (disk_used_percent{path='/data',group='{{.group}}'})"

# 容器运行情况（无容器时留空或删除此行）
container_query: "count by(ident) (docker_container_status_started_at{container_status='running',group='{{.group}}'})"
`),
	},
	{
		Key:         "linux_with_mysql_redis",
		Name:        "Linux + MySQL + Redis",
		Description: "标准服务器资源 + MySQL 和 Redis 在线状态及关键指标",
		Content: strings.TrimSpace(`
# 资源使用率
resources:
  cpu_query: "avg by(ident) (cpu_usage_active{cpu='cpu-total',group='{{.group}}'})"
  mem_query: "avg by(ident) (mem_used_percent{group='{{.group}}'})"
  disk_queries:
    - path: "/"
      query: "avg by(ident) (disk_used_percent{path='/',group='{{.group}}'})"
    - path: "/data"
      query: "avg by(ident) (disk_used_percent{path='/data',group='{{.group}}'})"

# 中间件监控
middlewares:
  - type: mysql
    query: "mysql_up{group='{{.group}}'}"
    online_value: 1
    extra_metrics:
      - name: "连接数"
        query: "mysql_global_status_threads_connected{group='{{.group}}'}"
      - name: "QPS"
        query: "rate(mysql_global_status_queries{group='{{.group}}'}[5m])"
  - type: redis
    query: "redis_up{group='{{.group}}'}"
    online_value: 1
    extra_metrics:
      - name: "连接数"
        query: "redis_connected_clients{group='{{.group}}'}"
      - name: "命中率"
        query: "redis_keyspace_hitrate{group='{{.group}}'}"

# 容器运行情况
container_query: "count by(ident) (docker_container_status_started_at{container_status='running',group='{{.group}}'})"
`),
	},
	{
		Key:         "linux_full_stack",
		Name:        "Linux 全栈（MySQL + Redis + Nacos）",
		Description: "标准资源 + MySQL / Redis / Nacos 三种中间件监控",
		Content: strings.TrimSpace(`
# 资源使用率
resources:
  cpu_query: "avg by(ident) (cpu_usage_active{cpu='cpu-total',group='{{.group}}'})"
  mem_query: "avg by(ident) (mem_used_percent{group='{{.group}}'})"
  disk_queries:
    - path: "/"
      query: "avg by(ident) (disk_used_percent{path='/',group='{{.group}}'})"
    - path: "/data"
      query: "avg by(ident) (disk_used_percent{path='/data',group='{{.group}}'})"

# 中间件监控
middlewares:
  - type: mysql
    query: "mysql_up{group='{{.group}}'}"
    online_value: 1
    extra_metrics:
      - name: "连接数"
        query: "mysql_global_status_threads_connected{group='{{.group}}'}"
      - name: "QPS"
        query: "rate(mysql_global_status_queries{group='{{.group}}'}[5m])"
  - type: redis
    query: "redis_up{group='{{.group}}'}"
    online_value: 1
    extra_metrics:
      - name: "连接数"
        query: "redis_connected_clients{group='{{.group}}'}"
      - name: "命中率"
        query: "redis_keyspace_hitrate{group='{{.group}}'}"
  - type: nacos
    query: "net_response_result_code{service='nacos',group='{{.group}}'}"
    online_value: 0

# 容器运行情况
container_query: "count by(ident) (docker_container_status_started_at{container_status='running',group='{{.group}}'})"
`),
	},
}

// ListPresets 获取内置预设模板列表
func ListPresets(c *gin.Context) {
	c.JSON(http.StatusOK, presets)
}

// validateTemplateContent 校验 YAML 内容能否被正确解析
// 返回错误描述，nil 表示合法
func validateTemplateContent(content string) error {
	// 复用 service 层的 TemplateConfig 做结构校验，避免两处定义不一致
	var cfg service.TemplateConfig
	return yaml.Unmarshal([]byte(content), &cfg)
}

// ListTemplates 获取模板列表
func ListTemplates(c *gin.Context) {
	rows, err := store.DB.Query("SELECT id, name, content, created_at FROM templates ORDER BY id DESC")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query templates"})
		return
	}
	defer rows.Close()

	var templates []model.Template
	for rows.Next() {
		var t model.Template
		if err := rows.Scan(&t.ID, &t.Name, &t.Content, &t.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan template"})
			return
		}
		templates = append(templates, t)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "row iteration error"})
		return
	}

	c.JSON(http.StatusOK, templates)
}

// CreateTemplate 创建模板
func CreateTemplate(c *gin.Context) {
	var t model.Template
	if err := c.ShouldBindJSON(&t); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if t.Name == "" || t.Content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name 和 content 为必填字段"})
		return
	}
	if err := validateTemplateContent(t.Content); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "YAML 格式错误: " + err.Error()})
		return
	}

	result, err := store.DB.Exec(
		"INSERT INTO templates (name, content) VALUES (?, ?)",
		t.Name, t.Content,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create template"})
		return
	}

	id, _ := result.LastInsertId()
	t.ID = id
	c.JSON(http.StatusCreated, t)
}

// GetTemplate 获取模板
func GetTemplate(c *gin.Context) {
	id := c.Param("id")
	var t model.Template
	err := store.DB.QueryRow(
		"SELECT id, name, content, created_at FROM templates WHERE id = ?",
		id,
	).Scan(&t.ID, &t.Name, &t.Content, &t.CreatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "template not found"})
		return
	}
	c.JSON(http.StatusOK, t)
}

// UpdateTemplate 更新模板
func UpdateTemplate(c *gin.Context) {
	id := c.Param("id")
	var t model.Template
	if err := c.ShouldBindJSON(&t); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if t.Name == "" || t.Content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name 和 content 为必填字段"})
		return
	}
	if err := validateTemplateContent(t.Content); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "YAML 格式错误: " + err.Error()})
		return
	}

	_, err := store.DB.Exec(
		"UPDATE templates SET name = ?, content = ? WHERE id = ?",
		t.Name, t.Content, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update template"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

// DeleteTemplate 删除模板
func DeleteTemplate(c *gin.Context) {
	id := c.Param("id")

	// 检查是否有项目正在引用该模板，有则拒绝删除
	var refCount int
	if err := store.DB.QueryRow("SELECT COUNT(*) FROM projects WHERE template_id = ?", id).Scan(&refCount); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check template references"})
		return
	}
	if refCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "模板正在被项目使用，无法删除"})
		return
	}

	_, err := store.DB.Exec("DELETE FROM templates WHERE id = ?", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete template"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}
