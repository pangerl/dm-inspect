package service

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"dm-inspect/internal/model"
)

// GenerateMarkdown 生成巡检报告的 Markdown 文本
func GenerateMarkdown(projectName, group, reportDate, status, errorMessage, failedBlocksJSON, warningsJSON, summaryJSON, blockResultsJSON, changesJSON string, data model.ReportData) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("# 巡检报告 - %s\n\n", projectName))
	sb.WriteString(fmt.Sprintf("**巡检日期**: %s  \n", reportDate))
	sb.WriteString(fmt.Sprintf("**巡检范围**: group=%s  \n", group))

	// ── 执行状态与摘要 ──────────────────────────────────────────
	statusLabel := map[string]string{"pending": "进行中", "completed": "已完成", "partial": "部分完成", "error": "失败"}
	sb.WriteString(fmt.Sprintf("**执行状态**: %s\n\n", statusLabel[status]))

	if status == "partial" || status == "error" {
		if errorMessage != "" {
			sb.WriteString(fmt.Sprintf("**错误信息**: %s\n\n", errorMessage))
		}
		var failedBlocks []string
		json.Unmarshal([]byte(failedBlocksJSON), &failedBlocks)
		if len(failedBlocks) > 0 {
			sb.WriteString(fmt.Sprintf("**失败区块**: %s\n\n", strings.Join(failedBlocks, ", ")))
		}
	}

	var warnings []string
	json.Unmarshal([]byte(warningsJSON), &warnings)
	if len(warnings) > 0 {
		sb.WriteString("**警告**:\n")
		for _, w := range warnings {
			sb.WriteString(fmt.Sprintf("- %s\n", w))
		}
		sb.WriteString("\n")
	}

	var summary model.Summary
	if err := json.Unmarshal([]byte(summaryJSON), &summary); err == nil {
		sb.WriteString("**异常摘要**:\n")
		sb.WriteString(fmt.Sprintf("- 离线服务器: %d\n", summary.OfflineServers))
		sb.WriteString(fmt.Sprintf("- 时间偏移异常: %d\n", summary.ClockOffsetIssues))
		sb.WriteString(fmt.Sprintf("- 磁盘风险: %d\n", summary.DiskCritical))
		sb.WriteString(fmt.Sprintf("- 中间件异常: %d\n", summary.MiddlewareAbnormal))
		sb.WriteString(fmt.Sprintf("- 告警 S1/S2/S3: %d/%d/%d\n", summary.AlertS1, summary.AlertS2, summary.AlertS3))
		sb.WriteString("\n")
	}

	// 变化检测
	var changes []model.ReportChange
	if err := json.Unmarshal([]byte(changesJSON), &changes); err == nil && len(changes) > 0 {
		sb.WriteString("**变化检测**（与昨日对比）:\n")
		for _, c := range changes {
			icon := "●"
			switch c.Type {
			case "added":
				icon = "🟢"
			case "removed":
				icon = "🔴"
			case "changed":
				icon = "🟡"
			case "trend":
				icon = "🔵"
			}
			sb.WriteString(fmt.Sprintf("- %s **%s**：%s", icon, c.Title, c.Detail))
			if c.Before != "" && c.After != "" {
				sb.WriteString(fmt.Sprintf("（%s → %s）", c.Before, c.After))
			}
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	} else {
		sb.WriteString("**变化检测**：与昨日相比无显著变化\n\n")
	}

	suggestions := BuildSuggestions(&summary)
	if len(suggestions) > 0 {
		sb.WriteString("**建议动作**:\n")
		for _, s := range suggestions {
			sb.WriteString(fmt.Sprintf("- %s\n", s))
		}
		sb.WriteString("\n")
	}

	sb.WriteString("---\n\n")

	// ── 一、服务器概览 ──────────────────────────────────────────
	// 预先按 ident 建立磁盘数据索引（VM instance 可能带端口，取前缀匹配）
	diskByIdent := buildDiskIndex(data.Resources)
	// 收集所有出现的磁盘路径（有序），作为动态列头
	diskPaths := collectDiskPaths(data.Resources)

	sb.WriteString("## 一、服务器概览\n\n")
	if len(data.Servers) == 0 {
		sb.WriteString("暂无服务器数据\n\n")
	} else {
		onlineCount := 0
		for _, s := range data.Servers {
			if s.Online {
				onlineCount++
			}
		}
		sb.WriteString(fmt.Sprintf("**在线**: %d  **离线**: %d  **合计**: %d\n\n",
			onlineCount, len(data.Servers)-onlineCount, len(data.Servers)))

		// 动态生成表头（磁盘列根据实际配置路径生成）
		sb.WriteString("| IP | 状态 | CPU核数 | CPU使用率 | 内存使用率 | 时间偏移")
		for _, p := range diskPaths {
			sb.WriteString(fmt.Sprintf(" | 磁盘(%s)", p))
		}
		sb.WriteString(" |\n")
		sb.WriteString("|-----|------|---------|-----------|------------|----------")
		for range diskPaths {
			sb.WriteString("|----------")
		}
		sb.WriteString("|\n")

		for _, s := range data.Servers {
			statusStr := "✅ 在线"
			if !s.Online {
				statusStr = "❌ 离线"
			}
			// 时间偏移绝对值 > 1000ms 标注警告
			offsetStr := fmt.Sprintf("%dms", s.Offset)
			if s.Offset > 1000 || s.Offset < -1000 {
				offsetStr = fmt.Sprintf("⚠️ %dms", s.Offset)
			}
			sb.WriteString(fmt.Sprintf("| %s | %s | %d | %.1f%% | %.1f%% | %s",
				s.Ident, statusStr, s.CPUNum, s.CPUUtil, s.MemUtil, offsetStr))
			for _, p := range diskPaths {
				val := "N/A"
				if disks, ok := diskByIdent[s.Ident]; ok {
					if v, ok := disks[p]; ok {
						val = fmt.Sprintf("%.1f%%", v)
					}
				}
				sb.WriteString(fmt.Sprintf(" | %s", val))
			}
			sb.WriteString(" |\n")
		}
		sb.WriteString("\n")
	}

	// ── 二、中间件监控 ──────────────────────────────────────────
	sb.WriteString("## 二、中间件监控\n\n")
	if len(data.Middlewares) == 0 {
		sb.WriteString("暂无中间件数据\n\n")
	} else {
		// 按类型分组输出
		byType := make(map[string][]model.MiddlewareStatus)
		var typeOrder []string
		for _, mw := range data.Middlewares {
			if _, exists := byType[mw.Type]; !exists {
				typeOrder = append(typeOrder, mw.Type)
			}
			byType[mw.Type] = append(byType[mw.Type], mw)
		}

		for _, t := range typeOrder {
			mws := byType[t]
			sb.WriteString(fmt.Sprintf("### %s\n\n", strings.ToUpper(t)))

			// 收集所有出现的 extra metric key
			metricKeys := collectMetricKeys(mws)

			sb.WriteString("| 实例 | 状态")
			for _, k := range metricKeys {
				sb.WriteString(fmt.Sprintf(" | %s", k))
			}
			sb.WriteString(" |\n")

			sb.WriteString("|------|------")
			for range metricKeys {
				sb.WriteString("|------")
			}
			sb.WriteString("|\n")

			for _, mw := range mws {
				statusStr := "✅ 在线"
				if !mw.Online {
					statusStr = "❌ 离线"
				}
				sb.WriteString(fmt.Sprintf("| %s | %s", mw.Instance, statusStr))
				for _, k := range metricKeys {
					v := mw.Metrics[k]
					if v == "" {
						v = "-"
					}
					sb.WriteString(fmt.Sprintf(" | %s", v))
				}
				sb.WriteString(" |\n")
			}
			sb.WriteString("\n")
		}
	}

	// ── 三、容器运行情况 ────────────────────────────────────────
	sb.WriteString("## 三、容器运行情况\n\n")
	if len(data.Containers) == 0 {
		sb.WriteString("暂无容器数据\n\n")
	} else {
		totalRunning := 0
		for _, c := range data.Containers {
			totalRunning += c.RunningCount
		}
		sb.WriteString(fmt.Sprintf("**运行中容器总数**: %d\n\n", totalRunning))

		// 判断是否有服务详情
		hasServices := false
		for _, c := range data.Containers {
			if len(c.Services) > 0 {
				hasServices = true
				break
			}
		}

		if hasServices {
			for _, c := range data.Containers {
				sb.WriteString(fmt.Sprintf("### %s（运行中 %d 个）\n\n", c.Instance, c.RunningCount))
				if len(c.Services) == 0 {
					sb.WriteString("无容器服务数据\n\n")
					continue
				}
				sb.WriteString("| 容器名 | 镜像 | 状态 | 启动时间 | 端口状态 |\n")
				sb.WriteString("|--------|------|------|----------|----------|\n")
				for _, svc := range c.Services {
					statusIcon := svc.Status
					if svc.Status == "running" {
						statusIcon = "✅ running"
					} else if svc.Status == "exited" {
						statusIcon = "❌ exited"
					}
					startedAt := "-"
					if svc.StartedAt > 0 {
						startedAt = time.Unix(svc.StartedAt, 0).Format("2006-01-02 15:04:05")
					}
					portStatus := "-"
					if len(svc.Ports) > 0 {
						var parts []string
						for _, p := range svc.Ports {
							icon := "❌"
							if p.OK {
								icon = "✅"
							}
							// 只展示端口号，不需要完整 IP
							port := p.Target
							if colonIdx := strings.LastIndex(port, ":"); colonIdx != -1 {
								port = port[colonIdx+1:]
							}
							parts = append(parts, fmt.Sprintf("%s %s", port, icon))
						}
						portStatus = strings.Join(parts, ", ")
					}
					image := svc.Image
					if image == "" {
						image = "-"
					}
					sb.WriteString(fmt.Sprintf("| %s | %s | %s | %s | %s |\n",
						svc.Name, image, statusIcon, startedAt, portStatus))
				}
				sb.WriteString("\n")
			}
		} else {
			// 旧模板兼容：仅展示统计
			sb.WriteString("| 服务器 | 运行中容器数 |\n")
			sb.WriteString("|--------|-------------|\n")
			for _, c := range data.Containers {
				sb.WriteString(fmt.Sprintf("| %s | %d |\n", c.Instance, c.RunningCount))
			}
			sb.WriteString("\n")
		}
	}

	// ── 四、告警信息 ────────────────────────────────────────────
	s1, s2, s3 := 0, 0, 0
	for _, a := range data.Alerts {
		switch a.Severity {
		case 1:
			s1++
		case 2:
			s2++
		case 3:
			s3++
		}
	}

	sb.WriteString("## 四、告警信息\n\n")
	sb.WriteString(fmt.Sprintf("**告警总数**: %d　**S1严重**: %d　**S2警告**: %d　**S3提示**: %d\n\n",
		len(data.Alerts), s1, s2, s3))

	if len(data.Alerts) == 0 {
		sb.WriteString("✅ 本次巡检周期内无告警\n\n")
	} else {
		sb.WriteString("| 规则 | 级别 | 目标 | 触发时间 | 状态 |\n")
		sb.WriteString("|------|------|------|----------|------|\n")
		for _, a := range data.Alerts {
			recovered := "未恢复"
			if a.IsRecovered {
				recovered = "已恢复"
			}
			sb.WriteString(fmt.Sprintf("| %s | S%d | %s | %s | %s |\n",
				a.RuleName, a.Severity, a.TargetIdent, a.TriggerTime, recovered))
		}
		sb.WriteString("\n")
	}

	sb.WriteString(fmt.Sprintf("---\n*报告生成时间: %s*\n", time.Now().Format("2006-01-02 15:04:05")))
	return sb.String()
}

// buildDiskIndex 从 resources 构建 ident→path→current 索引。
// VM instance 标签可能带端口（如 "172.0.0.1:9100"），取冒号前的 IP 部分做 key。
func buildDiskIndex(resources []model.ServerResource) map[string]map[string]float64 {
	idx := make(map[string]map[string]float64)
	for _, r := range resources {
		// 提取不含端口的 IP
		ip := r.Instance
		if i := strings.Index(ip, ":"); i != -1 {
			ip = ip[:i]
		}
		if idx[ip] == nil {
			idx[ip] = make(map[string]float64)
		}
		for _, d := range r.Disks {
			idx[ip][d.Path] = d.Current
		}
	}
	return idx
}

// collectDiskPaths 从 resources 中收集所有出现的磁盘路径（有序，去重）
func collectDiskPaths(resources []model.ServerResource) []string {
	seen := make(map[string]struct{})
	var paths []string
	for _, r := range resources {
		for _, d := range r.Disks {
			if _, exists := seen[d.Path]; !exists {
				seen[d.Path] = struct{}{}
				paths = append(paths, d.Path)
			}
		}
	}
	sort.Strings(paths)
	return paths
}

// collectMetricKeys 收集中间件列表中所有出现的 extra metric key（有序）
func collectMetricKeys(mws []model.MiddlewareStatus) []string {
	seen := make(map[string]struct{})
	var keys []string
	for _, mw := range mws {
		for k := range mw.Metrics {
			if _, exists := seen[k]; !exists {
				seen[k] = struct{}{}
				keys = append(keys, k)
			}
		}
	}
	return keys
}
