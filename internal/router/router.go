package router

import (
	"dm-inspect/internal/handler"

	"github.com/gin-gonic/gin"
)

// Setup 注册路由
func Setup(r *gin.Engine) {
	// API 路由
	api := r.Group("/api")
	{
		// 模板管理
		api.GET("/templates/presets", handler.ListPresets) // 须在 :id 路由之前注册
		api.GET("/templates", handler.ListTemplates)
		api.POST("/templates", handler.CreateTemplate)
		api.GET("/templates/:id", handler.GetTemplate)
		api.PUT("/templates/:id", handler.UpdateTemplate)
		api.DELETE("/templates/:id", handler.DeleteTemplate)

		// 项目管理
		api.GET("/projects", handler.ListProjects)
		api.POST("/projects", handler.CreateProject)
		api.GET("/projects/:id", handler.GetProject)
		api.PUT("/projects/:id", handler.UpdateProject)
		api.DELETE("/projects/:id", handler.DeleteProject)

		// 巡检执行
		api.POST("/executions", handler.ExecuteInspection)

		// 报告查询
		api.GET("/reports", handler.ListReports)
		api.GET("/reports/:id", handler.GetReport)
		api.GET("/reports/:id/markdown", handler.GetReportMarkdown)
	}

	// 前端静态文件
	r.Static("/assets", "./web/dist/assets")

	// SPA 路由：所有非 API 路由返回 index.html
	r.NoRoute(func(c *gin.Context) {
		c.File("./web/dist/index.html")
	})
}
