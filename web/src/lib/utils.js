import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(...inputs))
}

/**
 * 安全解析 JSON 字符串，失败或结果为 null 时返回 fallback
 */
export function safeParse(json, fallback) {
  if (!json || json === '') return fallback
  try {
    const val = JSON.parse(json)
    return val === null ? fallback : val
  } catch { return fallback }
}

/**
 * 返回昨天的日期字符串（YYYY-MM-DD）
 */
export function getYesterday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

/**
 * 从 summary JSON 生成简短摘要
 */
export function formatSummary(summaryJSON) {
  const s = safeParse(summaryJSON, {})
  if (!s || typeof s !== 'object') return '—'
  const parts = []
  if (s.offline_servers > 0) parts.push(`${s.offline_servers}台离线`)
  if (s.disk_critical > 0) parts.push(`${s.disk_critical}项磁盘风险`)
  if (s.middleware_abnormal > 0) parts.push(`${s.middleware_abnormal}个中间件异常`)
  if ((s.alert_s1 || 0) + (s.alert_s2 || 0) > 0) parts.push(`S1/S2告警${s.alert_s1 + s.alert_s2}条`)
  return parts.length > 0 ? parts.join('，') : '无异常'
}

/**
 * 从报告对象生成列表行摘要
 */
export function reportListSummary(report) {
  if (!report) return '—'
  if (report.status === 'error') return report.error_message || '巡检失败'
  if (report.status === 'partial') {
    const fb = safeParse(report.failed_blocks, [])
    if (fb.length > 0) return `${fb.join('、')} 查询失败`
  }
  return formatSummary(report.summary)
}
