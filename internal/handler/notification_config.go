package handler

import (
	"database/sql"
	"net/http"
	"strconv"

	"dm-inspect/internal/model"
	"dm-inspect/internal/store"

	"github.com/gin-gonic/gin"
)

// ListNotificationConfigs 获取通知配置列表
func ListNotificationConfigs(c *gin.Context) {
	rows, err := store.DB.Query(`
		SELECT id, name, notify_email, notify_wechat, enabled, created_at
		FROM notification_configs
		ORDER BY id DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query notification configs"})
		return
	}
	defer rows.Close()

	var configs []model.NotificationConfig
	for rows.Next() {
		var cfg model.NotificationConfig
		var enabled int
		if err := rows.Scan(&cfg.ID, &cfg.Name, &cfg.NotifyEmail, &cfg.NotifyWechat, &enabled, &cfg.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan notification config"})
			return
		}
		cfg.Enabled = enabled == 1
		configs = append(configs, cfg)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "row iteration error"})
		return
	}

	c.JSON(http.StatusOK, configs)
}

// CreateNotificationConfig 创建通知配置
func CreateNotificationConfig(c *gin.Context) {
	var cfg model.NotificationConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if cfg.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name 为必填字段"})
		return
	}
	if cfg.NotifyEmail == "" && cfg.NotifyWechat == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "至少填写一种通知渠道"})
		return
	}

	result, err := store.DB.Exec(`
		INSERT INTO notification_configs (name, notify_email, notify_wechat, enabled)
		VALUES (?, ?, ?, ?)
	`, cfg.Name, cfg.NotifyEmail, cfg.NotifyWechat, boolToInt(cfg.Enabled))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create notification config"})
		return
	}

	id, _ := result.LastInsertId()
	cfg.ID = id
	c.JSON(http.StatusCreated, cfg)
}

// GetNotificationConfig 获取通知配置详情
func GetNotificationConfig(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	cfg, err := findNotificationConfig(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification config not found"})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

// UpdateNotificationConfig 更新通知配置
func UpdateNotificationConfig(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var cfg model.NotificationConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if cfg.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name 为必填字段"})
		return
	}
	if cfg.NotifyEmail == "" && cfg.NotifyWechat == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "至少填写一种通知渠道"})
		return
	}

	result, err := store.DB.Exec(`
		UPDATE notification_configs
		SET name = ?, notify_email = ?, notify_wechat = ?, enabled = ?
		WHERE id = ?
	`, cfg.Name, cfg.NotifyEmail, cfg.NotifyWechat, boolToInt(cfg.Enabled), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update notification config"})
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification config not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

// DeleteNotificationConfig 删除通知配置
func DeleteNotificationConfig(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var refs int
	if err := store.DB.QueryRow("SELECT COUNT(*) FROM schedules WHERE notification_config_id = ?", id).Scan(&refs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check notification config references"})
		return
	}
	if refs > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "通知配置正在被定时任务使用，无法删除"})
		return
	}

	result, err := store.DB.Exec("DELETE FROM notification_configs WHERE id = ?", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete notification config"})
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification config not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func findNotificationConfig(id int64) (*model.NotificationConfig, error) {
	var cfg model.NotificationConfig
	var enabled int
	err := store.DB.QueryRow(`
		SELECT id, name, notify_email, notify_wechat, enabled, created_at
		FROM notification_configs
		WHERE id = ?
	`, id).Scan(&cfg.ID, &cfg.Name, &cfg.NotifyEmail, &cfg.NotifyWechat, &enabled, &cfg.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, err
	}
	cfg.Enabled = enabled == 1
	return &cfg, nil
}
