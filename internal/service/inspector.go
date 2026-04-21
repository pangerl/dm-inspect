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

	// 6. 并发执行4个区块查询
	var (
		servers     []model.TargetInfo
		resources   []model.ServerResource
		middlewares []model.MiddlewareStatus
		containers  []model.ContainerSummary
		alerts      []model.AlertResult
		mu          sync.Mutex
		wg          sync.WaitGroup
		queryErrs   []string
	)

	addErr := func(msg string) {
		mu.Lock()
		queryErrs = append(queryErrs, msg)
		mu.Unlock()
	}

	group := vars["group"]

	// 区块一：通过 N9E targets API 获取服务器列表及基础信息
	wg.Add(1)
	go func() {
		defer wg.Done()
		targets, err := i.n9eClient.GetTargets(ctx, group)
		if err != nil {
			addErr(fmt.Sprintf("get targets: %v", err))
			return
		}
		sort.Slice(targets, func(a, b int) bool { return targets[a].Ident < targets[b].Ident })
		mu.Lock()
		servers = targets
		mu.Unlock()
	}()

	// 区块二：资源使用率（并发查CPU/内存/多个磁盘分区）
	wg.Add(1)
	go func() {
		defer wg.Done()
		res := i.queryResources(ctx, cfg, vars, stime, etime)
		mu.Lock()
		resources = res
		mu.Unlock()
	}()

	// 区块三：中间件监控
	wg.Add(1)
	go func() {
		defer wg.Done()
		mws := i.queryMiddlewares(ctx, cfg, vars, etime)
		mu.Lock()
		middlewares = mws
		mu.Unlock()
	}()

	// 区块四：容器运行情况
	wg.Add(1)
	go func() {
		defer wg.Done()
		if cfg.ContainerQuery == "" {
			return
		}
		q := i.renderQuery(cfg.ContainerQuery, vars)
		points, err := i.vmClient.QueryInstant(ctx, q, etime)
		if err != nil {
			addErr(fmt.Sprintf("container query: %v", err))
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
	}()

	// 告警查询（非阻塞，失败不影响主流程）
	wg.Add(1)
	go func() {
		defer wg.Done()
		res, err := i.n9eClient.GetAlertEvents(ctx, stime, etime, group)
		if err != nil {
			log.Printf("[N9E] alert query failed: %v", err)
			res = []model.AlertResult{}
		}
		mu.Lock()
		alerts = res
		mu.Unlock()
	}()

	wg.Wait()

	if len(queryErrs) > 0 {
		log.Printf("[Inspector] query errors: %s", strings.Join(queryErrs, "; "))
	}

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

	// 8. 更新报告为 completed
	_, err = store.DB.Exec(
		"UPDATE reports SET data = ?, status = 'completed' WHERE id = ?",
		string(dataJSON), reportID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update report: %w", err)
	}

	report.Data = string(dataJSON)
	report.Status = "completed"

	// 9. 异步清理 30 天前的旧报告
	go i.cleanupOldReports()

	return report, nil
}

// queryResources 并发采集各机器的 CPU/内存/磁盘数据
func (i *Inspector) queryResources(ctx context.Context, cfg *TemplateConfig, vars map[string]string, stime, etime int64) []model.ServerResource {
	// 以 instance 为 key 汇聚各指标数据
	type entry struct {
		cpuCurrent, cpuMax float64
		memCurrent, memMax float64
		disks              []model.DiskUsage
	}
	byInstance := make(map[string]*entry)
	var mu sync.Mutex
	var wg sync.WaitGroup

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
			q := i.renderQuery(cfg.Resources.CPUQuery, vars)
			points, err := i.vmClient.QueryRange(ctx, q, stime, etime, vmQueryStep)
			if err != nil {
				log.Printf("[Inspector] CPU query failed: %v", err)
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
			q := i.renderQuery(cfg.Resources.MemQuery, vars)
			points, err := i.vmClient.QueryRange(ctx, q, stime, etime, vmQueryStep)
			if err != nil {
				log.Printf("[Inspector] Mem query failed: %v", err)
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
			q := i.renderQuery(dq.Query, vars)
			points, err := i.vmClient.QueryRange(ctx, q, stime, etime, vmQueryStep)
			if err != nil {
				log.Printf("[Inspector] Disk[%s] query failed: %v", dq.Path, err)
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
	return result
}

// queryMiddlewares 查询各中间件在线状态及关键指标
func (i *Inspector) queryMiddlewares(ctx context.Context, cfg *TemplateConfig, vars map[string]string, ts int64) []model.MiddlewareStatus {
	var result []model.MiddlewareStatus
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, mw := range cfg.Middlewares {
		mw := mw
		wg.Add(1)
		go func() {
			defer wg.Done()
			q := i.renderQuery(mw.Query, vars)
			points, err := i.vmClient.QueryInstant(ctx, q, ts)
			if err != nil {
				log.Printf("[Inspector] middleware[%s] query failed: %v", mw.Type, err)
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
				eq := i.renderQuery(em.Query, vars)
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
	return result
}

// parseTemplateConfig 解析 YAML 模板配置
func (i *Inspector) parseTemplateConfig(content string) (*TemplateConfig, error) {
	var cfg TemplateConfig
	if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
		return nil, fmt.Errorf("invalid template YAML: %w", err)
	}
	return &cfg, nil
}

func (i *Inspector) renderQuery(query string, vars map[string]string) string {
	result := query
	for key, value := range vars {
		placeholder := fmt.Sprintf("{{.%s}}", key)
		result = strings.ReplaceAll(result, placeholder, value)
	}
	return result
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

func (i *Inspector) cleanupOldReports() {
	cutoff := time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	_, err := store.DB.Exec("DELETE FROM reports WHERE report_date < ?", cutoff)
	if err != nil {
		log.Printf("cleanup old reports failed: %v", err)
	} else {
		log.Printf("cleaned up reports older than %s", cutoff)
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
