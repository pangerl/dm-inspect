package service

import (
	"fmt"
	"strings"

	"dm-inspect/internal/model"
)

// CompareReports 对比两份报告数据，返回变化列表
// yesterday 为 nil 时返回空切片（首次巡检无对比基线）
func CompareReports(current, yesterday model.ReportData) []model.ReportChange {
	if len(yesterday.Servers) == 0 && len(yesterday.Containers) == 0 &&
		len(yesterday.Middlewares) == 0 && len(yesterday.Alerts) == 0 {
		return nil
	}

	var changes []model.ReportChange

	changes = append(changes, diffServers(current.Servers, yesterday.Servers)...)
	changes = append(changes, diffContainers(current.Containers, yesterday.Containers)...)
	changes = append(changes, diffMiddlewares(current.Middlewares, yesterday.Middlewares)...)
	changes = append(changes, diffAlerts(current.Alerts, yesterday.Alerts)...)

	return changes
}

// diffServers 对比服务器资产变化
func diffServers(current, yesterday []model.TargetInfo) []model.ReportChange {
	var changes []model.ReportChange

	currMap := make(map[string]model.TargetInfo)
	for _, s := range current {
		currMap[s.Ident] = s
	}
	yestMap := make(map[string]model.TargetInfo)
	for _, s := range yesterday {
		yestMap[s.Ident] = s
	}

	// 新增服务器
	for ident, s := range currMap {
		if _, ok := yestMap[ident]; !ok {
			changes = append(changes, model.ReportChange{
				Type:     "added",
				Category: "server",
				Title:    fmt.Sprintf("%s 新纳入监控", ident),
				Detail:   fmt.Sprintf("CPU %d 核, 系统 %s", s.CPUNum, s.OS),
			})
		}
	}

	// 消失的服务器
	for ident, s := range yestMap {
		if _, ok := currMap[ident]; !ok {
			changes = append(changes, model.ReportChange{
				Type:     "removed",
				Category: "server",
				Title:    fmt.Sprintf("%s 脱离监控", ident),
				Detail:   fmt.Sprintf("昨日状态: %s", serverStatusText(s.Online)),
			})
		}
	}

	// 在线状态翻转
	for ident, curr := range currMap {
		if yest, ok := yestMap[ident]; ok {
			if curr.Online != yest.Online {
				changes = append(changes, model.ReportChange{
					Type:     "changed",
					Category: "server",
					Title:    fmt.Sprintf("%s 在线状态变化", ident),
					Detail:   fmt.Sprintf("%s → %s", serverStatusText(yest.Online), serverStatusText(curr.Online)),
					Before:   serverStatusText(yest.Online),
					After:    serverStatusText(curr.Online),
				})
			}
		}
	}

	return changes
}

// diffContainers 对比容器服务变化
func diffContainers(current, yesterday []model.ContainerSummary) []model.ReportChange {
	var changes []model.ReportChange

	// 构建索引：instance -> container_name -> ContainerService
	currMap := buildContainerIndex(current)
	yestMap := buildContainerIndex(yesterday)

	// 新增/消失的机器节点
	allInstances := make(map[string]bool)
	for inst := range currMap {
		allInstances[inst] = true
	}
	for inst := range yestMap {
		allInstances[inst] = true
	}

	for inst := range allInstances {
		currSvcs, currOk := currMap[inst]
		yestSvcs, yestOk := yestMap[inst]

		if !yestOk && currOk {
			// 全新节点
			changes = append(changes, model.ReportChange{
				Type:     "added",
				Category: "container",
				Title:    fmt.Sprintf("%s 新增容器节点", inst),
				Detail:   fmt.Sprintf("运行中 %d 个", len(currSvcs)),
			})
			continue
		}
		if yestOk && !currOk {
			changes = append(changes, model.ReportChange{
				Type:     "removed",
				Category: "container",
				Title:    fmt.Sprintf("%s 容器节点消失", inst),
				Detail:   fmt.Sprintf("昨日运行中 %d 个", len(yestSvcs)),
			})
			continue
		}

		// 对比同一节点下的容器
		allNames := make(map[string]bool)
		for name := range currSvcs {
			allNames[name] = true
		}
		for name := range yestSvcs {
			allNames[name] = true
		}

		for name := range allNames {
			currSvc, cOk := currSvcs[name]
			yestSvc, yOk := yestSvcs[name]

			if !yOk && cOk {
				changes = append(changes, model.ReportChange{
					Type:     "added",
					Category: "container",
					Title:    fmt.Sprintf("%s / %s 新增容器", inst, name),
					Detail:   fmt.Sprintf("状态: %s, 镜像: %s", currSvc.Status, currSvc.Image),
				})
				continue
			}
			if yOk && !cOk {
				changes = append(changes, model.ReportChange{
					Type:     "removed",
					Category: "container",
					Title:    fmt.Sprintf("%s / %s 容器消失", inst, name),
					Detail:   fmt.Sprintf("昨日状态: %s", yestSvc.Status),
				})
				continue
			}

			// 状态变化
			if currSvc.Status != yestSvc.Status {
				changes = append(changes, model.ReportChange{
					Type:     "changed",
					Category: "container",
					Title:    fmt.Sprintf("%s / %s 状态变化", inst, name),
					Detail:   fmt.Sprintf("%s → %s", yestSvc.Status, currSvc.Status),
					Before:   yestSvc.Status,
					After:    currSvc.Status,
				})
			}

			// 镜像名称变化（忽略 tag，避免每次 CI 发布产生噪音）
			currImageName := imageNameWithoutTag(currSvc.Image)
			yestImageName := imageNameWithoutTag(yestSvc.Image)
			if currImageName != yestImageName && currImageName != "" && yestImageName != "" {
				changes = append(changes, model.ReportChange{
					Type:     "changed",
					Category: "container",
					Title:    fmt.Sprintf("%s / %s 镜像更新", inst, name),
					Detail:   fmt.Sprintf("%s → %s", simplifyImageName(yestSvc.Image), simplifyImageName(currSvc.Image)),
					Before:   yestSvc.Image,
					After:    currSvc.Image,
				})
			}
		}
	}

	return changes
}

// diffMiddlewares 对比中间件变化
func diffMiddlewares(current, yesterday []model.MiddlewareStatus) []model.ReportChange {
	var changes []model.ReportChange

	// 使用 instance+type 作为唯一键
	key := func(m model.MiddlewareStatus) string {
		return m.Instance + "::" + m.Type
	}

	currMap := make(map[string]model.MiddlewareStatus)
	for _, m := range current {
		currMap[key(m)] = m
	}
	yestMap := make(map[string]model.MiddlewareStatus)
	for _, m := range yesterday {
		yestMap[key(m)] = m
	}

	// 新增
	for k, m := range currMap {
		if _, ok := yestMap[k]; !ok {
			changes = append(changes, model.ReportChange{
				Type:     "added",
				Category: "middleware",
				Title:    fmt.Sprintf("%s %s 新纳入监控", m.Instance, strings.ToUpper(m.Type)),
				Detail:   fmt.Sprintf("状态: %s", middlewareStatusText(m.Online)),
			})
		}
	}

	// 消失
	for k, m := range yestMap {
		if _, ok := currMap[k]; !ok {
			changes = append(changes, model.ReportChange{
				Type:     "removed",
				Category: "middleware",
				Title:    fmt.Sprintf("%s %s 脱离监控", m.Instance, strings.ToUpper(m.Type)),
				Detail:   fmt.Sprintf("昨日状态: %s", middlewareStatusText(m.Online)),
			})
		}
	}

	// 在线状态翻转
	for k, curr := range currMap {
		if yest, ok := yestMap[k]; ok {
			if curr.Online != yest.Online {
				changes = append(changes, model.ReportChange{
					Type:     "changed",
					Category: "middleware",
					Title:    fmt.Sprintf("%s %s 状态变化", curr.Instance, strings.ToUpper(curr.Type)),
					Detail:   fmt.Sprintf("%s → %s", middlewareStatusText(yest.Online), middlewareStatusText(curr.Online)),
					Before:   middlewareStatusText(yest.Online),
					After:    middlewareStatusText(curr.Online),
				})
			}
		}
	}

	return changes
}

// diffAlerts 对比告警变化：新增/消失的具体规则 + 各级别数量趋势
func diffAlerts(current, yesterday []model.AlertResult) []model.ReportChange {
	var changes []model.ReportChange

	// 以 "target::ruleName" 为键，仅统计未恢复的告警
	alertKey := func(a model.AlertResult) string {
		return a.TargetIdent + "::" + a.RuleName
	}

	currMap := make(map[string]model.AlertResult)
	for _, a := range current {
		if !a.IsRecovered {
			currMap[alertKey(a)] = a
		}
	}
	yestMap := make(map[string]model.AlertResult)
	for _, a := range yesterday {
		if !a.IsRecovered {
			yestMap[alertKey(a)] = a
		}
	}

	// 新增告警规则
	for k, a := range currMap {
		if _, ok := yestMap[k]; !ok {
			changes = append(changes, model.ReportChange{
				Type:     "added",
				Category: "alert",
				Title:    fmt.Sprintf("新触发 S%d 告警：%s", a.Severity, a.RuleName),
				Detail:   fmt.Sprintf("目标：%s", a.TargetIdent),
			})
		}
	}

	// 消失的告警规则（昨日存在、今日已不再触发）
	for k, a := range yestMap {
		if _, ok := currMap[k]; !ok {
			changes = append(changes, model.ReportChange{
				Type:     "removed",
				Category: "alert",
				Title:    fmt.Sprintf("已恢复 S%d 告警：%s", a.Severity, a.RuleName),
				Detail:   fmt.Sprintf("目标：%s", a.TargetIdent),
			})
		}
	}

	// 各级别数量趋势（补充整体感知）
	currS1, currS2, currS3 := countActiveAlerts(currMap)
	yestS1, yestS2, yestS3 := countActiveAlerts(yestMap)

	if currS1 != yestS1 {
		changes = append(changes, model.ReportChange{
			Type:     "trend",
			Category: "alert",
			Title:    "S1 严重告警数量变化",
			Detail:   fmt.Sprintf("%d → %d (%s)", yestS1, currS1, trendText(currS1, yestS1)),
			Before:   fmt.Sprintf("%d", yestS1),
			After:    fmt.Sprintf("%d", currS1),
		})
	}
	if currS2 != yestS2 {
		changes = append(changes, model.ReportChange{
			Type:     "trend",
			Category: "alert",
			Title:    "S2 警告告警数量变化",
			Detail:   fmt.Sprintf("%d → %d (%s)", yestS2, currS2, trendText(currS2, yestS2)),
			Before:   fmt.Sprintf("%d", yestS2),
			After:    fmt.Sprintf("%d", currS2),
		})
	}
	if currS3 != yestS3 {
		changes = append(changes, model.ReportChange{
			Type:     "trend",
			Category: "alert",
			Title:    "S3 提示告警数量变化",
			Detail:   fmt.Sprintf("%d → %d (%s)", yestS3, currS3, trendText(currS3, yestS3)),
			Before:   fmt.Sprintf("%d", yestS3),
			After:    fmt.Sprintf("%d", currS3),
		})
	}

	return changes
}

// buildContainerIndex 构建容器索引：instance -> container_name -> ContainerService
func buildContainerIndex(summaries []model.ContainerSummary) map[string]map[string]model.ContainerService {
	idx := make(map[string]map[string]model.ContainerService)
	for _, cs := range summaries {
		if idx[cs.Instance] == nil {
			idx[cs.Instance] = make(map[string]model.ContainerService)
		}
		for _, svc := range cs.Services {
			idx[cs.Instance][svc.Name] = svc
		}
	}
	return idx
}

// countActiveAlerts 统计未恢复告警各级别数量（操作已去重的 map）
func countActiveAlerts(alertMap map[string]model.AlertResult) (s1, s2, s3 int) {
	for _, a := range alertMap {
		switch a.Severity {
		case 1:
			s1++
		case 2:
			s2++
		case 3:
			s3++
		}
	}
	return
}

// trendText 生成趋势描述
func trendText(current, yesterday int) string {
	if current > yesterday {
		return fmt.Sprintf("+%d", current-yesterday)
	}
	if current < yesterday {
		return fmt.Sprintf("-%d", yesterday-current)
	}
	return "持平"
}

func serverStatusText(online bool) string {
	if online {
		return "在线"
	}
	return "离线"
}

func middlewareStatusText(online bool) string {
	if online {
		return "在线"
	}
	return "离线"
}

// imageNameWithoutTag 去掉镜像 tag（最后一个冒号后的部分），用于只比较镜像名称
// 例：registry.example.com/app:20260510-abc → registry.example.com/app
func imageNameWithoutTag(image string) string {
	// 找最后一个冒号，但要排除 registry 地址中的端口号（冒号后跟数字且后面还有斜杠）
	lastColon := strings.LastIndex(image, ":")
	if lastColon == -1 {
		return image
	}
	// 若冒号之后还有斜杠，则这是 registry:port/image 格式，冒号是端口分隔符而非 tag
	if strings.Contains(image[lastColon:], "/") {
		return image
	}
	return image[:lastColon]
}

