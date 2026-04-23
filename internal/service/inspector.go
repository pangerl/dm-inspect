package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"dm-inspect/internal/model"
	"dm-inspect/internal/store"

	"github.com/goccy/go-yaml"
)

// vmQueryStep VM 范围查询的采样步长（秒），对应 5 分钟采样间隔
const vmQueryStep = 300

// Inspector 巡检执行引擎
type Inspector struct {
	vmClient  *VMClient
	n9eClient *N9EClient
}

// NewInspector 创建巡检引擎
func NewInspector(vmEndpoint, n9eEndpoint, n9eUser, n9ePass string) *Inspector {
	return &Inspector{
		vmClient:  NewVMClient(vmEndpoint),
		n9eClient: NewN9EClient(n9eEndpoint, n9eUser, n9ePass),
	}
}

// TemplateConfig 巡检模板配置（YAML 解析结构）
type TemplateConfig struct {
	// 资源使用率
	Resources struct {
		CPUQuery    string `yaml:"cpu_query"`
		MemQuery    string `yaml:"mem_query"`
		DiskQueries []struct {
			Path  string `yaml:"path"`
			Query string `yaml:"query"`
		} `yaml:"disk_queries"`
	} `yaml:"resources"`

	// 中间件检测
	Middlewares []struct {
		Type        string `yaml:"type"`         // mysql / redis / nacos
		Query       string `yaml:"query"`        // 在线检测 PromQL（值=1在线，值=0离线）
		OnlineValue *int   `yaml:"online_value"` // 指针类型：nil=未配置(默认1)，0=nacos离线值
		// 附加指标
		ExtraMetrics []struct {
			Name  string `yaml:"name"`
			Query string `yaml:"query"`
		} `yaml:"extra_metrics"`
	} `yaml:"middlewares"`

	// 容器运行情况
	ContainerQuery string `yaml:"container_query"`
}

// Execute 执行巡检
func (i *Inspector) Execute(ctx context.Context, projectID int64, reportDate string) (*model.Report, error) {
	// 1. 加载项目
	project, err := i.loadProject(projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to load project: %w", err)
	}

	// 2. 解析变量
	vars, err := i.parseVariables(project.Variables)
	if err != nil {
		return nil, fmt.Errorf("failed to parse variables: %w", err)
	}
	if _, ok := vars["group"]; !ok {
		return nil, fmt.Errorf("project missing 'group' variable")
	}

	// 3. 加载并解析模板
	tmpl, err := i.loadTemplate(project.TemplateID)
	if err != nil {
		return nil, fmt.Errorf("failed to load template: %w", err)
	}
	cfg, err := i.parseTemplateConfig(tmpl.Content)
	if err != nil {
		return nil, fmt.Errorf("failed to parse template config: %w", err)
	}

	// 4. 计算时间窗口 (T day 全天)
	stime, etime, err := i.calcTimeWindow(reportDate)
	if err != nil {
		return nil, fmt.Errorf("invalid report date: %w", err)
	}

	// 5. 在数据库中创建报告记录（pending 状态）
	report := &model.Report{
		ProjectID:  projectID,
		ReportDate: reportDate,
		Status:     "pending",
	}
	reportID, err := i.createReport(report)
	if err != nil {
		return nil, fmt.Errorf("failed to create report: %w", err)
	}
	report.ID = reportID

	// 异常退出时自动标记为 error
	defer func() {
		if report.Status == "pending" {
			if _, err := store.DB.Exec("UPDATE reports SET status = 'error' WHERE id = ?", reportID); err != nil {
				log.Printf("[Inspector] failed to mark report %d as error: %v", reportID, err)
			}
			report.Status = "error"
		}
	}()

	// 6. 并发执行5个区块查询，收集结构化执行结果
	var (
		servers      []model.TargetInfo
		resources    []model.ServerResource
		middlewares  []model.MiddlewareStatus
		containers   []model.ContainerSummary
		alerts       []model.AlertResult
		mu           sync.Mutex
		wg           sync.WaitGroup
		blockResults []model.BlockResult
		warnings     []string
	)

	recordBlock := func(block, status, message string) {
		mu.Lock()
		blockResults = append(blockResults, model.BlockResult{
			Block:   block,
			Status:  status,
			Message: message,
		})
		mu.Unlock()
	}

	addWarning := func(msg string) {
		mu.Lock()
		warnings = append(warnings, msg)
		mu.Unlock()
	}

	group := vars["group"]

	// 区块一：通过 N9E targets API 获取服务器列表及基础信息
	wg.Add(1)
	go func() {
		defer wg.Done()
		targets, err := i.n9eClient.GetTargets(ctx, group)
		if err != nil {
			recordBlock("servers", "failed", fmt.Sprintf("获取服务器列表失败: %v", err))
			return
		}
		sort.Slice(targets, func(a, b int) bool { return targets[a].Ident < targets[b].Ident })
		mu.Lock()
		servers = targets
		mu.Unlock()
		recordBlock("servers", "success", "")
	}()

	// 区块二：资源使用率（并发查CPU/内存/多个磁盘分区）
	wg.Add(1)
	go func() {
		defer wg.Done()
		res, err := i.queryResources(ctx, cfg, vars, stime, etime)
		mu.Lock()
		resources = res
		mu.Unlock()
		if err != nil {
			recordBlock("resources", "failed", err.Error())
			return
		}
		recordBlock("resources", "success", "")
	}()

	// 区块三：中间件监控
	wg.Add(1)
	go func() {
		defer wg.Done()
		if len(cfg.Middlewares) == 0 {
			recordBlock("middlewares", "skipped", "未配置中间件监控")
			return
		}
		mws, err := i.queryMiddlewares(ctx, cfg, vars, etime)
		mu.Lock()
		middlewares = mws
		mu.Unlock()
		if err != nil {
			recordBlock("middlewares", "failed", err.Error())
			return
		}
		recordBlock("middlewares", "success", "")
	}()

	// 区块四：容器运行情况
	wg.Add(1)
	go func() {
		defer wg.Done()
		if cfg.ContainerQuery == "" {
			recordBlock("containers", "skipped", "container_query 未配置")
			return
		}
		q, err := i.renderQuery(cfg.ContainerQuery, vars)
		if err != nil {
			recordBlock("containers", "failed", fmt.Sprintf("渲染查询失败: %v", err))
			return
		}
		points, err := i.vmClient.QueryInstant(ctx, q, etime)
		if err != nil {
			recordBlock("containers", "failed", fmt.Sprintf("容器查询失败: %v", err))
			return
		}
		mu.Lock()
		for _, p := range points {
			inst := InstanceLabel(p.Labels)
			containers = append(containers, model.ContainerSummary{
				Instance:     inst,
				RunningCount: int(p.Value),
			})
		}
		sort.Slice(containers, func(a, b int) bool { return containers[a].Instance < containers[b].Instance })
		mu.Unlock()
		recordBlock("containers", "success", "")
	}()

	// 区块五：告警查询（失败降级为空，记录 warning）
	wg.Add(1)
	go func() {
		defer wg.Done()
		res, err := i.n9eClient.GetAlertEvents(ctx, stime, etime, group)
		if err != nil {
			addWarning(fmt.Sprintf("告警数据获取失败: %v", err))
			res = []model.AlertResult{}
		}
		mu.Lock()
		alerts = res
		mu.Unlock()
		recordBlock("alerts", "success", "")
	}()

	wg.Wait()

	// 7. 汇总并序列化报告数据
	reportData := model.ReportData{
		Servers:     servers,
		Resources:   resources,
		Middlewares: middlewares,
		Containers:  containers,
		Alerts:      alerts,
	}

	dataJSON, err := json.Marshal(reportData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal report data: %w", err)
	}

	// 8. 生成摘要、重点关注和建议
	summary := BuildSummary(reportData)
	summaryJSON, _ := json.Marshal(summary)

	highlights := BuildHighlights(reportData)
	highlightsJSON, _ := json.Marshal(highlights)

	suggestions := BuildSuggestions(summary)
	suggestionsJSON, _ := json.Marshal(suggestions)

	// 9. 计算最终状态
	failedBlocksList := []string{}
	for _, br := range blockResults {
		if br.Status == "failed" {
			failedBlocksList = append(failedBlocksList, br.Block)
		}
	}

	finalStatus := "completed"
	if len(failedBlocksList) > 0 {
		finalStatus = "partial"
	}

	blockResultsJSON, _ := json.Marshal(blockResults)
	warningsJSON, _ := json.Marshal(warnings)
	failedBlocksJSON, _ := json.Marshal(failedBlocksList)

	// 10. 组装报告对象
	report.Data = string(dataJSON)
	report.Status = finalStatus
	report.FailedBlocks = string(failedBlocksJSON)
	report.Warnings = string(warningsJSON)
	report.Summary = string(summaryJSON)
	report.BlockResults = string(blockResultsJSON)
	report.Highlights = string(highlightsJSON)
	report.Suggestions = string(suggestionsJSON)

	// 主错误信息：取第一个失败的区块信息
	if len(failedBlocksList) > 0 {
		for _, br := range blockResults {
			if br.Status == "failed" && br.Message != "" {
				report.ErrorMessage = br.Message
				break
			}
		}
	}

	// 11. 更新报告到数据库
	if err := i.updateReport(report); err != nil {
		return nil, fmt.Errorf("failed to update report: %w", err)
	}

	// 12. 异步清理 30 天前的旧报告
	go i.cleanupOldReports()

	return report, nil
}

// queryResources 并发采集各机器的 CPU/内存/磁盘数据，返回采集结果及可能发生的错误
func (i *Inspector) queryResources(ctx context.Context, cfg *TemplateConfig, vars map[string]string, stime, etime int64) ([]model.ServerResource, error) {
	// 以 instance 为 key 汇聚各指标数据
	type entry struct {
		cpuCurrent, cpuMax float64
		memCurrent, memMax float64
		disks              []model.DiskUsage
	}
	byInstance := make(map[string]*entry)
	var mu sync.Mutex
	var wg sync.WaitGroup

	// 错误收集
	var errs []string
	var errMu sync.Mutex
	addErr := func(msg string) {
		errMu.Lock()
		errs = append(errs, msg)
		errMu.Unlock()
	}

	ensureEntry := func(inst string) *entry {
		if byInstance[inst] == nil {
			byInstance[inst] = &entry{}
		}
		return byInstance[inst]
	}

	// CPU
	if cfg.Resources.CPUQuery != "" {
		wg.Add(1)
		go func() {
			defer wg.Done()
			q, err := i.renderQuery(cfg.Resources.CPUQuery, vars)
			if err != nil {
				addErr(fmt.Sprintf("CPU查询渲染失败: %v", err))
				return
			}
			points, err := i.vmClient.QueryRange(ctx, q, stime, etime, vmQueryStep)
			if err != nil {
				addErr(fmt.Sprintf("CPU查询失败: %v", err))
				return
			}
			mu.Lock()
			defer mu.Unlock()
			for _, p := range points {
				inst := InstanceLabel(p.Labels)
				e := ensureEntry(inst)
				e.cpuCurrent = p.Current
				e.cpuMax = p.Max
			}
		}()
	}

	// 内存
	if cfg.Resources.MemQuery != "" {
		wg.Add(1)
		go func() {
			defer wg.Done()
			q, err := i.renderQuery(cfg.Resources.MemQuery, vars)
			if err != nil {
				addErr(fmt.Sprintf("内存查询渲染失败: %v", err))
				return
			}
			points, err := i.vmClient.QueryRange(ctx, q, stime, etime, vmQueryStep)
			if err != nil {
				addErr(fmt.Sprintf("内存查询失败: %v", err))
				return
			}
			mu.Lock()
			defer mu.Unlock()
			for _, p := range points {
				inst := InstanceLabel(p.Labels)
				e := ensureEntry(inst)
				e.memCurrent = p.Current
				e.memMax = p.Max
			}
		}()
	}

	// 磁盘（多个分区）
	for _, dq := range cfg.Resources.DiskQueries {
		dq := dq // 捕获循环变量
		wg.Add(1)
		go func() {
			defer wg.Done()
			q, err := i.renderQuery(dq.Query, vars)
			if err != nil {
				addErr(fmt.Sprintf("磁盘[%s]查询渲染失败: %v", dq.Path, err))
				return
			}
			points, err := i.vmClient.QueryRange(ctx, q, stime, etime, vmQueryStep)
			if err != nil {
				addErr(fmt.Sprintf("磁盘[%s]查询失败: %v", dq.Path, err))
				return
			}
			mu.Lock()
			defer mu.Unlock()
			for _, p := range points {
				inst := InstanceLabel(p.Labels)
				e := ensureEntry(inst)
				e.disks = append(e.disks, model.DiskUsage{
					Path:    dq.Path,
					Current: p.Current,
					Max:     p.Max,
				})
			}
		}()
	}

	wg.Wait()

	// 转换为有序切片
	var result []model.ServerResource
	for inst, e := range byInstance {
		sort.Slice(e.disks, func(a, b int) bool { return e.disks[a].Path < e.disks[b].Path })
		result = append(result, model.ServerResource{
			Instance:   inst,
			CPUCurrent: e.cpuCurrent,
			CPUMax:     e.cpuMax,
			MemCurrent: e.memCurrent,
			MemMax:     e.memMax,
			Disks:      e.disks,
		})
	}
	sort.Slice(result, func(a, b int) bool { return result[a].Instance < result[b].Instance })

	if len(errs) > 0 {
		return result, fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return result, nil
}

// queryMiddlewares 查询各中间件在线状态及关键指标，返回查询结果及可能发生的错误
func (i *Inspector) queryMiddlewares(ctx context.Context, cfg *TemplateConfig, vars map[string]string, ts int64) ([]model.MiddlewareStatus, error) {
	var result []model.MiddlewareStatus
	var mu sync.Mutex
	var wg sync.WaitGroup

	// 错误收集
	var errs []string
	var errMu sync.Mutex
	addErr := func(msg string) {
		errMu.Lock()
		errs = append(errs, msg)
		errMu.Unlock()
	}

	for _, mw := range cfg.Middlewares {
		mw := mw
		wg.Add(1)
		go func() {
			defer wg.Done()
			q, err := i.renderQuery(mw.Query, vars)
			if err != nil {
				addErr(fmt.Sprintf("%s查询渲染失败: %v", mw.Type, err))
				return
			}
			points, err := i.vmClient.QueryInstant(ctx, q, ts)
			if err != nil {
				addErr(fmt.Sprintf("%s查询失败: %v", mw.Type, err))
				return
			}

			// 每个 instance 对应一条中间件状态
			byInst := make(map[string]*model.MiddlewareStatus)
			// nil 表示未配置，默认值为 1（在线）；配置了 0 时（如 nacos）以实际值为准
			onlineVal := float64(1)
			if mw.OnlineValue != nil {
				onlineVal = float64(*mw.OnlineValue)
			}

			for _, p := range points {
				inst := InstanceLabel(p.Labels)
				if _, exists := byInst[inst]; !exists {
					byInst[inst] = &model.MiddlewareStatus{
						Instance: inst,
						Type:     mw.Type,
						Online:   p.Value == onlineVal,
						Metrics:  make(map[string]string),
					}
				}
			}

			// 附加指标（在线的实例才查）
			for _, em := range mw.ExtraMetrics {
				eq, err := i.renderQuery(em.Query, vars)
				if err != nil {
					log.Printf("[Inspector] render middleware[%s] extra metric[%s] failed: %v", mw.Type, em.Name, err)
					continue
				}
				eps, err := i.vmClient.QueryInstant(ctx, eq, ts)
				if err != nil {
					log.Printf("[Inspector] middleware[%s] extra metric[%s] failed: %v", mw.Type, em.Name, err)
					continue
				}
				for _, ep := range eps {
					inst := InstanceLabel(ep.Labels)
					if s, exists := byInst[inst]; exists && s.Online {
						s.Metrics[em.Name] = fmt.Sprintf("%.2f", ep.Value)
					}
				}
			}

			mu.Lock()
			for _, s := range byInst {
				result = append(result, *s)
			}
			mu.Unlock()
		}()
	}

	wg.Wait()
	sort.Slice(result, func(a, b int) bool {
		if result[a].Type != result[b].Type {
			return result[a].Type < result[b].Type
		}
		return result[a].Instance < result[b].Instance
	})

	if len(errs) > 0 {
		return result, fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return result, nil
}

// parseTemplateConfig 解析 YAML 模板配置
func (i *Inspector) parseTemplateConfig(content string) (*TemplateConfig, error) {
	var cfg TemplateConfig
	if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
		return nil, fmt.Errorf("invalid template YAML: %w", err)
	}
	return &cfg, nil
}

func (i *Inspector) renderQuery(query string, vars map[string]string) (string, error) {
	result := query
	for key, value := range vars {
		placeholder := fmt.Sprintf("{{.%s}}", key)
		result = strings.ReplaceAll(result, placeholder, value)
	}
	// 检测是否存在未定义的变量占位符
	if strings.Contains(result, "{{.") {
		return "", fmt.Errorf("query contains undefined variables after rendering: %s", result)
	}
	return result, nil
}

func (i *Inspector) calcTimeWindow(reportDate string) (int64, int64, error) {
	t, err := time.Parse("2006-01-02", reportDate)
	if err != nil {
		return 0, 0, fmt.Errorf("expected format YYYY-MM-DD: %w", err)
	}
	start := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
	end := time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 0, time.Local)
	return start.Unix(), end.Unix(), nil
}

func (i *Inspector) loadProject(projectID int64) (*model.Project, error) {
	var p model.Project
	err := store.DB.QueryRow(
		"SELECT id, name, template_id, variables FROM projects WHERE id = ?",
		projectID,
	).Scan(&p.ID, &p.Name, &p.TemplateID, &p.Variables)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (i *Inspector) loadTemplate(templateID int64) (*model.Template, error) {
	var t model.Template
	err := store.DB.QueryRow(
		"SELECT id, name, content FROM templates WHERE id = ?",
		templateID,
	).Scan(&t.ID, &t.Name, &t.Content)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (i *Inspector) parseVariables(variablesJSON string) (map[string]string, error) {
	var vars map[string]string
	if err := json.Unmarshal([]byte(variablesJSON), &vars); err != nil {
		return nil, err
	}
	return vars, nil
}

func (i *Inspector) createReport(report *model.Report) (int64, error) {
	result, err := store.DB.Exec(
		"INSERT INTO reports (project_id, report_date, data, status) VALUES (?, ?, ?, ?)",
		report.ProjectID, report.ReportDate, report.Data, report.Status,
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

// updateReport 更新报告的完整字段（含 v3 新增字段）
func (i *Inspector) updateReport(report *model.Report) error {
	_, err := store.DB.Exec(`
		UPDATE reports SET
			data = ?,
			status = ?,
			error_message = ?,
			failed_blocks = ?,
			warnings = ?,
			summary = ?,
			block_results = ?
		WHERE id = ?
	`, report.Data, report.Status, report.ErrorMessage, report.FailedBlocks,
		report.Warnings, report.Summary, report.BlockResults, report.ID)
	return err
}

func (i *Inspector) cleanupOldReports() {
	// 使用 SQLite date 函数进行日期比较，避免字符串格式潜在问题
	_, err := store.DB.Exec("DELETE FROM reports WHERE report_date < date('now', '-30 days')")
	if err != nil {
		log.Printf("cleanup old reports failed: %v", err)
	} else {
		log.Printf("cleaned up reports older than 30 days")
	}
}

// GetProjectReport 获取项目指定日期的报告
func (i *Inspector) GetProjectReport(projectID int64, reportDate string) (*model.Report, error) {
	var r model.Report
	err := store.DB.QueryRow(
		"SELECT id, project_id, report_date, data, status FROM reports WHERE project_id = ? AND report_date = ?",
		projectID, reportDate,
	).Scan(&r.ID, &r.ProjectID, &r.ReportDate, &r.Data, &r.Status)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// BuildSummary 从报告数据生成摘要统计（包级函数，供 handler 复用）
func BuildSummary(data model.ReportData) *model.Summary {
	s := &model.Summary{}
	for _, srv := range data.Servers {
		if !srv.Online {
			s.OfflineServers++
		}
		if srv.Offset > 30000 || srv.Offset < -30000 {
			s.ClockOffsetIssues++
		}
	}
	diskCriticalSet := make(map[string]bool)
	for _, res := range data.Resources {
		for _, d := range res.Disks {
			if d.Current >= 80 {
				diskCriticalSet[res.Instance] = true
			}
		}
	}
	s.DiskCritical = len(diskCriticalSet)
	for _, mw := range data.Middlewares {
		if !mw.Online {
			s.MiddlewareAbnormal++
		}
	}
	for _, a := range data.Alerts {
		switch a.Severity {
		case 1:
			s.AlertS1++
		case 2:
			s.AlertS2++
		case 3:
			s.AlertS3++
		}
	}
	return s
}

// BuildHighlights 从报告数据生成重点关注项（按优先级排序，包级函数，供 handler 复用）
func BuildHighlights(data model.ReportData) []model.Highlight {
	highlights := make([]model.Highlight, 0)

	// 1. 离线服务器（最高优先级）
	for _, srv := range data.Servers {
		if !srv.Online {
			highlights = append(highlights, model.Highlight{
				Level:    "critical",
				Category: "server",
				Title:    fmt.Sprintf("%s 离线", srv.Ident),
				Detail:   "服务器在 N9E 中标记为离线",
			})
		}
	}

	// 2. 磁盘风险
	diskIssues := make(map[string][]string)
	for _, res := range data.Resources {
		for _, d := range res.Disks {
			if d.Current >= 80 {
				ip := res.Instance
				if idx := strings.Index(ip, ":"); idx != -1 {
					ip = ip[:idx]
				}
				diskIssues[ip] = append(diskIssues[ip], fmt.Sprintf("%s %.1f%%", d.Path, d.Current))
			}
		}
	}
	for ip, issues := range diskIssues {
		highlights = append(highlights, model.Highlight{
			Level:    "warning",
			Category: "disk",
			Title:    fmt.Sprintf("%s 磁盘使用率过高", ip),
			Detail:   strings.Join(issues, ", "),
		})
	}

	// 3. 时间偏移异常
	for _, srv := range data.Servers {
		if srv.Offset > 30000 || srv.Offset < -30000 {
			highlights = append(highlights, model.Highlight{
				Level:    "warning",
				Category: "server",
				Title:    fmt.Sprintf("%s 时间偏移异常", srv.Ident),
				Detail:   fmt.Sprintf("偏移 %dms", srv.Offset),
			})
		}
	}

	// 4. 中间件离线
	for _, mw := range data.Middlewares {
		if !mw.Online {
			highlights = append(highlights, model.Highlight{
				Level:    "critical",
				Category: "middleware",
				Title:    fmt.Sprintf("%s %s 离线", mw.Instance, mw.Type),
				Detail:   "中间件在线检测失败",
			})
		}
	}

	// 5. 高等级未恢复告警
	for _, a := range data.Alerts {
		if !a.IsRecovered && a.Severity <= 2 {
			level := "warning"
			if a.Severity == 1 {
				level = "critical"
			}
			highlights = append(highlights, model.Highlight{
				Level:    level,
				Category: "alert",
				Title:    fmt.Sprintf("%s 触发 %s", a.TargetIdent, a.RuleName),
				Detail:   fmt.Sprintf("S%d 告警，未恢复", a.Severity),
			})
		}
	}

	return highlights
}

// BuildSuggestions 基于摘要生成建议动作（包级函数，供 handler 复用）
func BuildSuggestions(s *model.Summary) []string {
	suggestions := make([]string, 0)
	if s.OfflineServers > 0 {
		suggestions = append(suggestions, fmt.Sprintf("有 %d 台服务器离线，建议检查网络连通性和 Agent 运行状态", s.OfflineServers))
	}
	if s.DiskCritical > 0 {
		suggestions = append(suggestions, fmt.Sprintf("有 %d 台服务器磁盘使用率超过 80%%，建议及时清理或扩容", s.DiskCritical))
	}
	if s.MiddlewareAbnormal > 0 {
		suggestions = append(suggestions, fmt.Sprintf("有 %d 个中间件实例异常，建议检查服务状态和依赖资源", s.MiddlewareAbnormal))
	}
	if s.AlertS1 > 0 || s.AlertS2 > 0 {
		suggestions = append(suggestions, fmt.Sprintf("存在 S1/S2 级别告警 %d 条，建议优先排查根因", s.AlertS1+s.AlertS2))
	}
	return suggestions
}
