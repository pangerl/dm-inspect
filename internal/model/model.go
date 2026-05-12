package model

import "time"

// Template 巡检模板
type Template struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Content   string    `json:"content"` // YAML 格式
	CreatedAt time.Time `json:"created_at"`
}

// Project 巡检项目
type Project struct {
	ID         int64     `json:"id"`
	Name       string    `json:"name"`
	TemplateID int64     `json:"template_id"`
	Variables  string    `json:"variables"` // JSON: {"group": "kuvera-prod"}
	CreatedAt  time.Time `json:"created_at"`
}

// Report 巡检报告
type Report struct {
	ID            int64     `json:"id"`
	ProjectID     int64     `json:"project_id"`
	ProjectName   string    `json:"project_name,omitempty"` // 列表查询时 join 填充
	ReportDate    string    `json:"report_date"`            // 2026-04-20
	Data          string    `json:"data"`                   // JSON: ReportData
	Status        string    `json:"status"`                 // pending / completed / partial / error
	ErrorMessage  string    `json:"error_message"`
	FailedBlocks  string    `json:"failed_blocks"`          // JSON: []string
	Warnings      string    `json:"warnings"`               // JSON: []string
	Summary       string    `json:"summary"`                // JSON: Summary
	BlockResults  string    `json:"block_results"`          // JSON: []BlockResult
	Highlights    string    `json:"highlights,omitempty"`   // JSON: []Highlight，运行时组装
	Suggestions   string    `json:"suggestions,omitempty"`  // JSON: []string，运行时组装
	Changes       string    `json:"changes,omitempty"`      // JSON: []ReportChange
	CreatedAt     time.Time `json:"created_at"`
}

// ReportData 报告数据结构（4个区块）
type ReportData struct {
	Servers     []TargetInfo       `json:"servers"`
	Resources   []ServerResource   `json:"resources"`
	Middlewares []MiddlewareStatus `json:"middlewares"`
	Containers  []ContainerSummary `json:"containers"`
	Alerts      []AlertResult      `json:"alerts"`
}

// TargetInfo 服务器概览信息（来自 N9E targets API，区块一）
type TargetInfo struct {
	Ident        string  `json:"ident"`          // IP / 主机标识
	HostIP       string  `json:"host_ip"`        // 宿主机 IP
	OS           string  `json:"os"`             // 操作系统
	CPUNum       int     `json:"cpu_num"`        // CPU 核数
	CPUUtil      float64 `json:"cpu_util"`       // CPU 使用率 %
	MemUtil      float64 `json:"mem_util"`       // 内存使用率 %
	Offset       int64   `json:"offset"`         // 时间偏移 ms
	Online       bool    `json:"online"`         // target_up >= 1
	AgentVersion string  `json:"agent_version"`  // Agent 版本
}

// DiskUsage 磁盘分区使用情况
type DiskUsage struct {
	Path    string  `json:"path"`
	Current float64 `json:"current"` // 当前使用率 %
	Max     float64 `json:"max"`     // 时间窗口内最大值
	NA      bool    `json:"na"`      // 分区不存在
}

// ServerResource 单台服务器磁盘使用率（区块二）
type ServerResource struct {
	Instance   string      `json:"instance"`
	Disks      []DiskUsage `json:"disks"`
}

// MiddlewareStatus 中间件状态（区块三）
type MiddlewareStatus struct {
	Instance string            `json:"instance"`
	Type     string            `json:"type"`              // mysql / redis / nacos
	Online   bool              `json:"online"`
	Metrics  map[string]string `json:"metrics,omitempty"` // 关键指标 KV
}

// ContainerPort 容器端口连通状态
type ContainerPort struct {
	Target string `json:"target"` // 如 172.31.36.36:10000
	OK     bool   `json:"ok"`     // true 表示连通
}

// ContainerService 单个容器服务信息
type ContainerService struct {
	Name      string          `json:"name"`
	Image     string          `json:"image"`
	Status    string          `json:"status"` // running / exited / paused 等
	StartedAt int64           `json:"started_at,omitempty"`
	Ports     []ContainerPort `json:"ports,omitempty"`
}

// ContainerSummary 单台机器容器运行情况（区块四）
type ContainerSummary struct {
	Instance     string             `json:"instance"`
	RunningCount int                `json:"running_count"`
	Services     []ContainerService `json:"services,omitempty"`
}

// AlertResult 告警事件
type AlertResult struct {
	RuleName    string `json:"rule_name"`
	Severity    int    `json:"severity"`
	IsRecovered bool   `json:"is_recovered"`
	TargetIdent string `json:"target_ident"`
	TriggerTime string `json:"trigger_time"`
	Tags        string `json:"tags"`
}

// BlockResult 单个区块的执行结果
type BlockResult struct {
	Block  string `json:"block"`  // servers / resources / middlewares / containers / alerts
	Status string `json:"status"` // success / failed / skipped
	Message string `json:"message"`
}

// Summary 报告摘要统计
type Summary struct {
	OfflineServers      int `json:"offline_servers"`
	ClockOffsetIssues   int `json:"clock_offset_issues"`
	DiskCritical        int `json:"disk_critical"`
	MiddlewareAbnormal  int `json:"middleware_abnormal"`
	AlertS1             int `json:"alert_s1"`
	AlertS2             int `json:"alert_s2"`
	AlertS3             int `json:"alert_s3"`
}

// ReportChange 单条变化记录
type ReportChange struct {
	Type     string `json:"type"`     // added / removed / changed / trend
	Category string `json:"category"` // server / container / middleware / disk / alert
	Title    string `json:"title"`    // 展示文案
	Detail   string `json:"detail"`   // 详细说明
	Before   string `json:"before"`   // 变化前值
	After    string `json:"after"`    // 变化后值
}

// Highlight 重点关注项
type Highlight struct {
	Level       string `json:"level"`       // critical / warning / info
	Category    string `json:"category"`    // server / disk / middleware / alert
	Title       string `json:"title"`       // 展示文案
	Detail      string `json:"detail"`      // 详细说明
}

// Schedule 定时巡检任务
type Schedule struct {
	ID             int64     `json:"id"`
	ProjectID      int64     `json:"project_id"`
	Name           string    `json:"name"`
	Cron           string    `json:"cron"`
	InspectionType string    `json:"inspection_type"` // daily / monthly / quarterly / yearly
	Enabled        bool      `json:"enabled"`
	NotifyEmail    string    `json:"notify_email"`    // 逗号分隔多个邮箱
	NotifyWechat   string    `json:"notify_wechat"`   // 企业微信 webhook URL
	CreatedAt      time.Time `json:"created_at"`
}

// ScheduleLog 定时任务执行记录
type ScheduleLog struct {
	ID             int64     `json:"id"`
	ScheduleID     int64     `json:"schedule_id"`
	ReportID       int64     `json:"report_id"`
	Status         string    `json:"status"`          // success / failed
	NotifiedEmail  bool      `json:"notified_email"`
	NotifiedWechat bool      `json:"notified_wechat"`
	ErrorMessage   string    `json:"error_message"`
	CreatedAt      time.Time `json:"created_at"`
}
