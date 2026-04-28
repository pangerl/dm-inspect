package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/robfig/cron/v3"

	"dm-inspect/internal/model"
	"dm-inspect/internal/store"
)

// ScheduleManager 定时任务管理器
type ScheduleManager struct {
	cron      *cron.Cron
	inspector *Inspector
	notifier  *Notifier
	entries   map[int64]cron.EntryID // schedule_id -> cron entry id
	mu        sync.RWMutex
}

// NewScheduleManager 创建定时任务管理器
func NewScheduleManager(inspector *Inspector, notifier *Notifier) *ScheduleManager {
	return &ScheduleManager{
		cron:      cron.New(cron.WithSeconds()),
		inspector: inspector,
		notifier:  notifier,
		entries:   make(map[int64]cron.EntryID),
	}
}

// Start 启动 cron 调度器
func (m *ScheduleManager) Start() {
	m.cron.Start()
}

// Stop 停止 cron 调度器
func (m *ScheduleManager) Stop() {
	ctx := m.cron.Stop()
	// 等待正在执行的任务完成（最多 10 秒）
	select {
	case <-ctx.Done():
	case <-time.After(10 * time.Second):
	}
}

// LoadAll 从数据库加载所有启用的定时任务
func (m *ScheduleManager) LoadAll() error {
	rows, err := store.DB.Query(`
		SELECT id, project_id, name, cron, inspection_type, enabled, notify_email, notify_wechat
		FROM schedules WHERE enabled = 1
	`)
	if err != nil {
		return fmt.Errorf("查询定时任务失败: %w", err)
	}
	defer rows.Close()

	var loaded int
	for rows.Next() {
		var s model.Schedule
		var enabled int
		if err := rows.Scan(
			&s.ID, &s.ProjectID, &s.Name, &s.Cron, &s.InspectionType,
			&enabled, &s.NotifyEmail, &s.NotifyWechat,
		); err != nil {
			log.Printf("[scheduler] 加载任务失败: %v", err)
			continue
		}
		s.Enabled = enabled == 1
		if err := m.addEntry(s); err != nil {
			log.Printf("[scheduler] 注册任务 %d(%s) 失败: %v", s.ID, s.Name, err)
			continue
		}
		loaded++
	}
	log.Printf("[scheduler] 已加载 %d 个定时任务", loaded)
	return rows.Err()
}

// Add 添加并注册一个新任务
func (m *ScheduleManager) Add(s model.Schedule) error {
	if err := m.addEntry(s); err != nil {
		return err
	}
	return nil
}

// Remove 移除一个定时任务
func (m *ScheduleManager) Remove(scheduleID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if entryID, ok := m.entries[scheduleID]; ok {
		m.cron.Remove(entryID)
		delete(m.entries, scheduleID)
		log.Printf("[scheduler] 任务 %d 已移除", scheduleID)
	}
}

// Reload 重新加载单个任务（用于更新后）
func (m *ScheduleManager) Reload(s model.Schedule) error {
	m.Remove(s.ID)
	if s.Enabled {
		if err := m.addEntry(s); err != nil {
			return err
		}
	}
	return nil
}

// RunOnce 手动立即执行一次任务
func (m *ScheduleManager) RunOnce(scheduleID int64) {
	go m.runSchedule(scheduleID)
}

// addEntry 将任务注册到 cron（内部方法，不加锁，调用方需保证同步）
func (m *ScheduleManager) addEntry(s model.Schedule) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 若已存在，先移除
	if oldID, ok := m.entries[s.ID]; ok {
		m.cron.Remove(oldID)
		delete(m.entries, s.ID)
	}

	entryID, err := m.cron.AddFunc(s.Cron, func() {
		m.runSchedule(s.ID)
	})
	if err != nil {
		return fmt.Errorf("无效的 cron 表达式 %q: %w", s.Cron, err)
	}

	m.entries[s.ID] = entryID
	nextRun := m.cron.Entry(entryID).Next
	log.Printf("[scheduler] 任务 %d(%s) 已注册，下次执行: %s", s.ID, s.Name, nextRun.Format("2006-01-02 15:04:05"))
	return nil
}

// runSchedule 执行单个定时任务的核心逻辑
func (m *ScheduleManager) runSchedule(scheduleID int64) {
	log.Printf("[scheduler] 任务 %d 开始执行", scheduleID)

	// 1. 查询任务配置
	var s model.Schedule
	var enabled int
	err := store.DB.QueryRow(`
		SELECT id, project_id, name, cron, inspection_type, enabled, notify_email, notify_wechat
		FROM schedules WHERE id = ?
	`, scheduleID).Scan(
		&s.ID, &s.ProjectID, &s.Name, &s.Cron, &s.InspectionType,
		&enabled, &s.NotifyEmail, &s.NotifyWechat,
	)
	if err != nil {
		log.Printf("[scheduler] 任务 %d 配置查询失败: %v", scheduleID, err)
		m.writeLog(scheduleID, 0, "failed", false, false, err.Error())
		return
	}
	s.Enabled = enabled == 1
	if !s.Enabled {
		log.Printf("[scheduler] 任务 %d 已禁用，跳过执行", scheduleID)
		return
	}

	// 2. 查询项目名称
	var projectName string
	if err := store.DB.QueryRow("SELECT name FROM projects WHERE id = ?", s.ProjectID).Scan(&projectName); err != nil {
		projectName = fmt.Sprintf("项目%d", s.ProjectID)
	}

	// 3. 计算 report_date
	reportDate := calcReportDate(s.InspectionType, time.Now())
	log.Printf("[scheduler] 任务 %d 巡检日期: %s", scheduleID, reportDate)

	// 4. 执行巡检
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	report, err := m.inspector.Execute(ctx, s.ProjectID, reportDate)
	if err != nil {
		log.Printf("[scheduler] 任务 %d 巡检执行失败: %v", scheduleID, err)
		m.writeLog(scheduleID, 0, "failed", false, false, err.Error())
		return
	}

	log.Printf("[scheduler] 任务 %d 巡检完成，报告 ID: %d", scheduleID, report.ID)

	// 5. 获取项目 group 变量
	var variables string
	if err := store.DB.QueryRow("SELECT variables FROM projects WHERE id = ?", s.ProjectID).Scan(&variables); err != nil {
		log.Printf("[scheduler] warn: failed to load project variables for project_id=%d: %v", s.ProjectID, err)
	}
	varsMap := make(map[string]string)
	if variables != "" {
		if err := json.Unmarshal([]byte(variables), &varsMap); err != nil {
			log.Printf("[scheduler] warn: failed to parse project variables for project_id=%d: %v", s.ProjectID, err)
		}
	}
	group := varsMap["group"]

	// 6. 发送通知（异步，不阻塞）
	if m.notifier != nil {
		m.notifier.AsyncNotify(projectName, group, reportDate, report, s.NotifyEmail, s.NotifyWechat)
	}

	// 7. 记录日志
	m.writeLog(scheduleID, report.ID, "success", s.NotifyEmail != "", s.NotifyWechat != "", "")
}

// writeLog 写入 schedule_logs
func (m *ScheduleManager) writeLog(scheduleID, reportID int64, status string, email, wechat bool, errMsg string) {
	_, err := store.DB.Exec(`
		INSERT INTO schedule_logs (schedule_id, report_id, status, notified_email, notified_wechat, error_message)
		VALUES (?, ?, ?, ?, ?, ?)
	`, scheduleID, reportID, status, boolToInt(email), boolToInt(wechat), errMsg)
	if err != nil {
		log.Printf("[scheduler] 写入日志失败: %v", err)
	}
}

// calcReportDate 根据巡检类型计算 report_date
func calcReportDate(inspectionType string, now time.Time) string {
	switch inspectionType {
	case "monthly":
		// 上月最后一天
		firstDay := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		return firstDay.AddDate(0, 0, -1).Format("2006-01-02")
	case "quarterly":
		// 上季度最后一天
		var quarterStartMonth time.Month
		switch {
		case now.Month() <= 3:
			quarterStartMonth = time.January
		case now.Month() <= 6:
			quarterStartMonth = time.April
		case now.Month() <= 9:
			quarterStartMonth = time.July
		default:
			quarterStartMonth = time.October
		}
		firstDay := time.Date(now.Year(), quarterStartMonth, 1, 0, 0, 0, 0, now.Location())
		return firstDay.AddDate(0, 0, -1).Format("2006-01-02")
	case "yearly":
		// 去年 12-31
		return time.Date(now.Year()-1, 12, 31, 0, 0, 0, 0, now.Location()).Format("2006-01-02")
	default:
		// daily 默认 T-1
		return now.AddDate(0, 0, -1).Format("2006-01-02")
	}
}

// boolToInt bool 转 int（SQLite 布尔存储）
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// NextRunTime 获取指定任务的下一次执行时间
func (m *ScheduleManager) NextRunTime(scheduleID int64) *time.Time {
	m.mu.RLock()
	defer m.mu.RUnlock()

	entryID, ok := m.entries[scheduleID]
	if !ok {
		return nil
	}
	entry := m.cron.Entry(entryID)
	if entry.Valid() {
		return &entry.Next
	}
	return nil
}
