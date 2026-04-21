package handler

import (
	"context"
	"log"
	"net/http"
	"time"

	"dm-inspect/internal/service"

	"github.com/gin-gonic/gin"
)

// 全局 inspector 实例（后续可改为依赖注入）
var inspector *service.Inspector

// executionSem 限制最多 3 个并发巡检，防止资源耗尽
var executionSem = make(chan struct{}, 3)

// InitInspector 初始化巡检引擎
func InitInspector(vmEndpoint, n9eEndpoint, n9eUser, n9ePass string) {
	inspector = service.NewInspector(vmEndpoint, n9eEndpoint, n9eUser, n9ePass)
}

// ExecuteInspection 触发巡检执行
func ExecuteInspection(c *gin.Context) {
	var req struct {
		ProjectID  int64  `json:"project_id"`
		ReportDate string `json:"report_date"` // 可选，默认 T-1
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.ProjectID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project_id is required"})
		return
	}

	// 默认 T-1
	if req.ReportDate == "" {
		req.ReportDate = time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	}

	// 异步执行，避免超时
	// 使用独立 context，避免 handler 返回后 context 被取消
	go func(projectID int64, reportDate string) {
		// 获取信号量，限制最多 3 个并发巡检
		executionSem <- struct{}{}
		defer func() { <-executionSem }()

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		_, err := inspector.Execute(ctx, projectID, reportDate)
		if err != nil {
			log.Printf("[巡检失败] projectID=%d, date=%s, err=%v", projectID, reportDate, err)
		}
	}(req.ProjectID, req.ReportDate)

	c.JSON(http.StatusAccepted, gin.H{
		"message":     "inspection started",
		"project_id":  req.ProjectID,
		"report_date": req.ReportDate,
	})
}
