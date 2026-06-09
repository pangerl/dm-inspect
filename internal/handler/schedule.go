package handler

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"dm-inspect/internal/model"
	"dm-inspect/internal/service"
	"dm-inspect/internal/store"

	"github.com/gin-gonic/gin"
)

var scheduleMgr *service.ScheduleManager

// SetScheduleManager 注入定时任务管理器
func SetScheduleManager(mgr *service.ScheduleManager) {
	scheduleMgr = mgr
}

// GetScheduleManager 获取当前注入的定时任务管理器（测试专用）
func GetScheduleManager() *service.ScheduleManager {
	return scheduleMgr
}

// ListSchedules 获取定时任务列表
func ListSchedules(c *gin.Context) {
	rows, err := store.DB.Query(`
		SELECT s.id, s.project_id, s.name, s.cron, s.inspection_type, s.enabled,
		       COALESCE(s.notification_config_id, 0), COALESCE(n.name, ''),
		       COALESCE(n.notify_email, s.notify_email, ''), COALESCE(n.notify_wechat, s.notify_wechat, ''),
		       s.created_at, p.name as project_name
		FROM schedules s
		LEFT JOIN projects p ON s.project_id = p.id
		LEFT JOIN notification_configs n ON s.notification_config_id = n.id
		ORDER BY s.id DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query schedules"})
		return
	}
	defer rows.Close()

	type ScheduleWithProject struct {
		model.Schedule
		ProjectName string     `json:"project_name"`
		NextRun     *time.Time `json:"next_run,omitempty"`
	}

	var schedules []ScheduleWithProject
	for rows.Next() {
		var s ScheduleWithProject
		var enabled int
		if err := rows.Scan(
			&s.ID, &s.ProjectID, &s.Name, &s.Cron, &s.InspectionType, &enabled,
			&s.NotificationConfigID, &s.NotificationConfigName,
			&s.NotifyEmail, &s.NotifyWechat, &s.CreatedAt, &s.ProjectName,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan schedule"})
			return
		}
		s.Enabled = enabled == 1
		if scheduleMgr != nil {
			s.NextRun = scheduleMgr.NextRunTime(s.ID)
		}
		schedules = append(schedules, s)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "row iteration error"})
		return
	}

	c.JSON(http.StatusOK, schedules)
}

// CreateSchedule 创建定时任务
func CreateSchedule(c *gin.Context) {
	var s model.Schedule
	if err := c.ShouldBindJSON(&s); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if s.Name == "" || s.Cron == "" || s.ProjectID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name、cron、project_id 为必填字段"})
		return
	}
	if !notificationConfigExists(c, s.NotificationConfigID) {
		return
	}

	result, err := store.DB.Exec(`
		INSERT INTO schedules (project_id, name, cron, inspection_type, enabled, notification_config_id, notify_email, notify_wechat)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, s.ProjectID, s.Name, s.Cron, s.InspectionType, boolToInt(s.Enabled),
		nullInt64(s.NotificationConfigID), s.NotifyEmail, s.NotifyWechat)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create schedule"})
		return
	}

	id, _ := result.LastInsertId()
	s.ID = id

	// 若启用，注册到 cron
	if s.Enabled && scheduleMgr != nil {
		if err := scheduleMgr.Add(s); err != nil {
			// 注册失败不阻断创建，仅记录日志
			fmt.Printf("[schedule] 注册 cron 任务失败: %v\n", err)
		}
	}

	c.JSON(http.StatusCreated, s)
}

// GetSchedule 获取定时任务详情
func GetSchedule(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var s model.Schedule
	var enabled int
	var notificationConfigID sql.NullInt64
	var notificationConfigName sql.NullString
	err = store.DB.QueryRow(`
		SELECT s.id, s.project_id, s.name, s.cron, s.inspection_type, s.enabled,
		       s.notification_config_id, n.name,
		       COALESCE(n.notify_email, s.notify_email, ''),
		       COALESCE(n.notify_wechat, s.notify_wechat, ''), s.created_at
		FROM schedules s
		LEFT JOIN notification_configs n ON s.notification_config_id = n.id
		WHERE s.id = ?
	`, id).Scan(
		&s.ID, &s.ProjectID, &s.Name, &s.Cron, &s.InspectionType, &enabled,
		&notificationConfigID, &notificationConfigName, &s.NotifyEmail, &s.NotifyWechat, &s.CreatedAt,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "schedule not found"})
		return
	}
	s.Enabled = enabled == 1
	if notificationConfigID.Valid {
		s.NotificationConfigID = notificationConfigID.Int64
	}
	if notificationConfigName.Valid {
		s.NotificationConfigName = notificationConfigName.String
	}
	c.JSON(http.StatusOK, s)
}

// UpdateSchedule 更新定时任务
func UpdateSchedule(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var s model.Schedule
	if err := c.ShouldBindJSON(&s); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if s.Name == "" || s.Cron == "" || s.ProjectID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name、cron、project_id 为必填字段"})
		return
	}
	if !notificationConfigExists(c, s.NotificationConfigID) {
		return
	}

	_, err = store.DB.Exec(`
		UPDATE schedules
		SET project_id = ?, name = ?, cron = ?, inspection_type = ?, enabled = ?,
		    notification_config_id = ?, notify_email = ?, notify_wechat = ?
		WHERE id = ?
	`, s.ProjectID, s.Name, s.Cron, s.InspectionType, boolToInt(s.Enabled),
		nullInt64(s.NotificationConfigID), s.NotifyEmail, s.NotifyWechat, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update schedule"})
		return
	}

	s.ID = id
	// 重新加载 cron
	if scheduleMgr != nil {
		if err := scheduleMgr.Reload(s); err != nil {
			fmt.Printf("[schedule] 重载 cron 任务失败: %v\n", err)
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

// DeleteSchedule 删除定时任务
func DeleteSchedule(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	// 从 cron 移除
	if scheduleMgr != nil {
		scheduleMgr.Remove(id)
	}

	_, err = store.DB.Exec("DELETE FROM schedules WHERE id = ?", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete schedule"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

// RunSchedule 手动立即执行一次定时任务
func RunSchedule(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	// 校验任务存在
	var count int
	if err := store.DB.QueryRow("SELECT COUNT(*) FROM schedules WHERE id = ?", id).Scan(&count); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check schedule"})
		return
	}
	if count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "schedule not found"})
		return
	}

	if scheduleMgr != nil {
		scheduleMgr.RunOnce(id)
	}

	c.JSON(http.StatusAccepted, gin.H{"message": "inspection started", "schedule_id": id})
}

// ListScheduleLogs 获取定时任务的执行历史
func ListScheduleLogs(c *gin.Context) {
	scheduleID := c.Param("id")
	if _, err := strconv.ParseInt(scheduleID, 10, 64); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid schedule_id"})
		return
	}

	rows, err := store.DB.Query(`
		SELECT id, schedule_id, report_id, status, notified_email, notified_wechat, error_message, created_at
		FROM schedule_logs
		WHERE schedule_id = ?
		ORDER BY id DESC
		LIMIT 50
	`, scheduleID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query logs"})
		return
	}
	defer rows.Close()

	var logs []model.ScheduleLog
	for rows.Next() {
		var l model.ScheduleLog
		var email, wechat int
		if err := rows.Scan(
			&l.ID, &l.ScheduleID, &l.ReportID, &l.Status,
			&email, &wechat, &l.ErrorMessage, &l.CreatedAt,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan log"})
			return
		}
		l.NotifiedEmail = email == 1
		l.NotifiedWechat = wechat == 1
		logs = append(logs, l)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "row iteration error"})
		return
	}

	c.JSON(http.StatusOK, logs)
}

// boolToInt bool 转 int
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullInt64(v int64) interface{} {
	if v == 0 {
		return nil
	}
	return v
}

func notificationConfigExists(c *gin.Context, id int64) bool {
	if id == 0 {
		return true
	}
	var count int
	if err := store.DB.QueryRow("SELECT COUNT(*) FROM notification_configs WHERE id = ?", id).Scan(&count); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check notification config"})
		return false
	}
	if count == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "notification_config_id 不存在"})
		return false
	}
	return true
}

// 兼容旧版 handler 中的 scan 类型断言（避免 sql.NullInt64 问题）
func scanNullInt64(v interface{}) int64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case int64:
		return val
	case int:
		return int64(val)
	default:
		return 0
	}
}
