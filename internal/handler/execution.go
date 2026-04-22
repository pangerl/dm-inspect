package handler

import (
	"context"
	"log"
	"net/http"
	"time"

	"dm-inspect/internal/service"

	"github.com/gin-gonic/gin"
)

var (
	inspectorSvc *service.Inspector
	executionSem = make(chan struct{}, 3)
)

// SetInspector 注入巡检引擎实例（便于测试时 mock）
func SetInspector(svc *service.Inspector) {
	inspectorSvc = svc
}

// GetInspector 获取当前注入的巡检引擎实例（测试专用）
func GetInspector() *service.Inspector {
	return inspectorSvc
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
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[PANIC] inspection goroutine panic: projectID=%d, date=%s, err=%v", projectID, reportDate, r)
			}
			<-executionSem
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		_, err := inspectorSvc.Execute(ctx, projectID, reportDate)
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
