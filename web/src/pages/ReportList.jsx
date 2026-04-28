import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'

// 安全解析 JSON，失败或结果为 null 时返回默认值
function safeParse(json, fallback) {
  if (!json || json === '') return fallback
  try {
    const val = JSON.parse(json)
    return val === null ? fallback : val
  } catch { return fallback }
}

// 从 summary JSON 生成简短摘要
function formatSummary(summaryJSON) {
  const s = safeParse(summaryJSON, {})
  if (!s || typeof s !== 'object') return '—'
  const parts = []
  if (s.offline_servers > 0) parts.push(`${s.offline_servers}台离线`)
  if (s.disk_critical > 0) parts.push(`${s.disk_critical}项磁盘风险`)
  if (s.middleware_abnormal > 0) parts.push(`${s.middleware_abnormal}个中间件异常`)
  if ((s.alert_s1 || 0) + (s.alert_s2 || 0) > 0) parts.push(`S1/S2告警${s.alert_s1 + s.alert_s2}条`)
  return parts.length > 0 ? parts.join('，') : '无异常'
}

// 生成报告列表的一行摘要
function reportListSummary(report) {
  if (!report) return '—'
  if (report.status === 'error') return report.error_message || '巡检失败'
  if (report.status === 'partial') {
    const fb = safeParse(report.failed_blocks, [])
    if (fb.length > 0) return `${fb.join('、')} 查询失败`
  }
  return formatSummary(report.summary)
}

export default function ReportList() {
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [filterProject, setFilterProject] = useState(searchParams.get('project_id') || '')
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '')
  const [filterDate, setFilterDate] = useState(searchParams.get('date') || '')
  const [projectOptions, setProjectOptions] = useState([])
  const [reports, setReports] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [selectedReport, setSelectedReport] = useState(null)
  const [markdown, setMarkdown] = useState('')
  const [executingProject, setExecutingProject] = useState(false)
  const [execDate, setExecDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  })
  const pollTimerRef = useRef(null)
  const pendingCheckTimerRef = useRef(null)

  useEffect(() => {
    api.get('/projects')
      .then(data => setProjectOptions(data || []))
      .catch(() => {})
  }, [])

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams()
    if (filterProject) params.set('project_id', filterProject)
    if (filterStatus) params.set('status', filterStatus)
    if (filterDate) params.set('date', filterDate)
    params.set('page', String(page))
    params.set('page_size', String(pageSize))
    return params.toString()
  }, [filterProject, filterStatus, filterDate, page, pageSize])

  const fetchReports = useCallback(() => {
    const qs = buildQuery()
    const url = `/reports?${qs}`
    return api.get(url)
      .then(data => {
        setReports(data?.list || [])
        setTotal(data?.total || 0)
        return data?.list || []
      })
      .catch(err => {
        toast.error(err.message)
        throw err
      })
  }, [buildQuery, toast])

  useEffect(() => {
    setLoading(true)
    fetchReports().finally(() => setLoading(false))
    return () => {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
      clearTimeout(pendingCheckTimerRef.current)
      pendingCheckTimerRef.current = null
    }
  }, [fetchReports])

  useEffect(() => {
    const hasPending = reports.some(r => r.status === 'pending')
    if (hasPending && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(fetchReports, 5000)
    } else if (!hasPending && pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [fetchReports, reports])

  const updateFilters = (updates) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([k, v]) => {
      if (v) next.set(k, v)
      else next.delete(k)
    })
    setSearchParams(next)
    if (updates.project_id !== undefined) setFilterProject(updates.project_id)
    if (updates.status !== undefined) setFilterStatus(updates.status)
    if (updates.date !== undefined) setFilterDate(updates.date)
    setPage(1)
    setSelectedReport(null)
  }

  const handleViewReport = async (report) => {
    try {
      const [detail, md] = await Promise.all([
        api.get(`/reports/${report.id}`),
        api.get(`/reports/${report.id}/markdown`)
      ])
      setSelectedReport(detail)
      setMarkdown(md)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      toast.success('已复制到剪贴板')
    } catch {
      toast.error('复制失败，请手动选择复制')
    }
  }

  const handleExecuteForProject = async () => {
    const projectId = parseInt(filterProject)
    setExecutingProject(true)
    try {
      await api.post('/executions', { project_id: projectId, report_date: execDate })
      const proj = projectOptions.find(p => p.id === projectId)
      toast.success(`「${proj?.name || ''}」${execDate} 巡检已启动`)
      const tryFetch = (delay) => {
        pendingCheckTimerRef.current = setTimeout(() => {
          fetchReports().then(data => {
            const hasPending = (data || []).some(r => r.status === 'pending')
            if (!hasPending && delay < 10000) tryFetch(delay + 3000)
          })
        }, delay)
      }
      tryFetch(2000)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setExecutingProject(false)
    }
  }

  if (loading) return <Spinner />

  const selectedProject = projectOptions.find(p => String(p.id) === filterProject)

  // 解析选中报告的扩展字段
  const selectedSummary = selectedReport ? safeParse(selectedReport.summary, {}) : {}
  const selectedFailedBlocks = selectedReport ? safeParse(selectedReport.failed_blocks, []) : []
  const selectedWarnings = selectedReport ? safeParse(selectedReport.warnings, []) : []
  const selectedBlockResults = selectedReport ? safeParse(selectedReport.block_results, []) : []
  const selectedHighlights = selectedReport ? safeParse(selectedReport.highlights, []) : []
  const selectedSuggestions = selectedReport ? safeParse(selectedReport.suggestions, []) : []

  const blockStatusIcon = (status) => {
    if (status === 'success')
      return (
        <svg className="w-4 h-4 text-ds-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )
    if (status === 'failed')
      return (
        <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )
    if (status === 'skipped')
      return (
        <svg className="w-4 h-4 text-ds-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
        </svg>
      )
    return (
      <svg className="w-4 h-4 text-ds-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" strokeWidth={2} />
      </svg>
    )
  }

  // 判断摘要是否有实际数据（避免旧报告显示全0的无意义卡片）
  const hasSummaryData = selectedSummary && (
    (selectedSummary.offline_servers || 0) > 0 ||
    (selectedSummary.clock_offset_issues || 0) > 0 ||
    (selectedSummary.disk_critical || 0) > 0 ||
    (selectedSummary.middleware_abnormal || 0) > 0 ||
    (selectedSummary.alert_s1 || 0) > 0 ||
    (selectedSummary.alert_s2 || 0) > 0 ||
    (selectedSummary.alert_s3 || 0) > 0
  )

  return (
    <div>
      {/* 页面头 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-ds-text">巡检报告</h1>
          <p className="text-sm text-ds-muted mt-0.5">
            查看巡检结果、执行状态和异常摘要
            {Array.isArray(reports) && reports.some(r => r?.status === 'pending') && (
              <span className="ml-2 text-amber-400 inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
                有任务进行中，每5秒自动刷新
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {filterProject && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={execDate}
                onChange={e => setExecDate(e.target.value)}
                className="px-3 py-2 border border-ds-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent"
              />
              <button
                onClick={handleExecuteForProject}
                disabled={executingProject}
                className="inline-flex items-center gap-1.5 bg-ds-accent text-ds-text text-sm font-medium px-4 py-2 rounded-lg hover:bg-ds-accent-hover disabled:opacity-60 transition-colors"
              >
                {executingProject ? (
                  <span className="w-4 h-4 border-2 border-ds-text border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {executingProject ? '启动中' : '执行巡检'}
              </button>
            </div>
          )}
          <select
            value={filterProject}
            onChange={e => updateFilters({ project_id: e.target.value })}
            className="px-3 py-2 border border-ds-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent"
          >
            <option value="">全部项目</option>
            {projectOptions.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => updateFilters({ status: e.target.value })}
            className="px-3 py-2 border border-ds-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent"
          >
            <option value="">全部状态</option>
            <option value="pending">进行中</option>
            <option value="completed">已完成</option>
            <option value="partial">部分完成</option>
            <option value="error">失败</option>
          </select>
          <input
            type="date"
            value={filterDate}
            onChange={e => updateFilters({ date: e.target.value })}
            className="px-3 py-2 border border-ds-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent"
          />
        </div>
      </div>

      {reports.length === 0 ? (
        <EmptyState
          title="暂无报告"
          description={filterProject ? `「${selectedProject?.name}」尚未执行过巡检` : '请先前往项目管理执行巡检'}
          action={
            filterProject ? (
              <button
                onClick={handleExecuteForProject}
                disabled={executingProject}
                className="inline-flex items-center gap-1.5 bg-ds-accent text-ds-text text-sm font-medium px-4 py-2 rounded-lg hover:bg-ds-accent-hover disabled:opacity-60 transition-colors"
              >
                立即执行巡检
              </button>
            ) : (
              <Link to="/projects"
                className="inline-flex items-center gap-1.5 bg-ds-accent text-ds-text text-sm font-medium px-4 py-2 rounded-lg hover:bg-ds-accent-hover transition-colors"
              >
                前往巡检项目
              </Link>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* 报告列表（左侧） */}
          <div className="lg:col-span-2 bg-ds-surface rounded-xl border border-ds-border overflow-hidden self-start">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-ds-border bg-ds-surface2">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider">项目</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider">日期</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider">状态</th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ds-border">
                {reports.map(r => (
                  <tr
                    key={r.id}
                    className={`cursor-pointer hover:bg-ds-surface2 transition-colors ${
                      selectedReport?.id === r.id ? 'bg-ds-accent/10 hover:bg-ds-accent/10' : ''
                    }`}
                    onClick={() => handleViewReport(r)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-ds-text truncate max-w-[140px]">{r.project_name}</div>
                      <div className="text-xs text-ds-muted mt-0.5 truncate max-w-[140px]">{reportListSummary(r)}</div>
                    </td>
                    <td className="px-4 py-3 text-ds-muted whitespace-nowrap">{r.report_date}</td>
                    <td className="px-4 py-3">
                      <Badge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <svg className={`w-4 h-4 inline-block transition-colors ${selectedReport?.id === r.id ? 'text-ds-accent' : 'text-ds-muted'}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 分页 */}
            {total > pageSize && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-ds-border">
                <div className="text-xs text-ds-muted">
                  共 {total} 条，第 {page} / {Math.ceil(total / pageSize)} 页
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-2 py-1 text-xs rounded border border-ds-border text-ds-muted hover:bg-ds-surface2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    上一页
                  </button>
                  {Array.from({ length: Math.ceil(total / pageSize) }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === Math.ceil(total / pageSize) || Math.abs(p - page) <= 1)
                    .map((p, idx, arr) => (
                      <span key={p} className="flex items-center gap-1">
                        {idx > 0 && arr[idx - 1] !== p - 1 && (
                          <span className="text-xs text-ds-muted px-1">...</span>
                        )}
                        <button
                          onClick={() => setPage(p)}
                          className={`w-7 h-7 text-xs rounded border transition-colors ${
                            p === page
                              ? 'bg-ds-accent border-ds-accent text-ds-text'
                              : 'border-ds-border text-ds-muted hover:bg-ds-surface2'
                          }`}
                        >
                          {p}
                        </button>
                      </span>
                    ))}
                  <button
                    onClick={() => setPage(p => Math.min(Math.ceil(total / pageSize), p + 1))}
                    disabled={page >= Math.ceil(total / pageSize)}
                    className="px-2 py-1 text-xs rounded border border-ds-border text-ds-muted hover:bg-ds-surface2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 报告详情（右侧） */}
          <div className="lg:col-span-3 space-y-4">
            {selectedReport ? (
              <>
                {/* 1. 巡检摘要卡片 */}
                {hasSummaryData && (
                  <div className="bg-ds-surface rounded-xl border border-ds-border p-5">
                    <h3 className="text-sm font-semibold text-ds-text mb-3">巡检摘要</h3>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                      <div className="text-center p-2 bg-ds-surface2 rounded-lg">
                        <div className="text-lg font-bold text-ds-text">{selectedSummary.offline_servers || 0}</div>
                        <div className="text-[10px] text-ds-muted">离线</div>
                      </div>
                      <div className="text-center p-2 bg-ds-surface2 rounded-lg">
                        <div className="text-lg font-bold text-ds-text">{selectedSummary.clock_offset_issues || 0}</div>
                        <div className="text-[10px] text-ds-muted">时间偏移</div>
                      </div>
                      <div className="text-center p-2 bg-ds-surface2 rounded-lg">
                        <div className="text-lg font-bold text-ds-text">{selectedSummary.disk_critical || 0}</div>
                        <div className="text-[10px] text-ds-muted">磁盘风险</div>
                      </div>
                      <div className="text-center p-2 bg-ds-surface2 rounded-lg">
                        <div className="text-lg font-bold text-ds-text">{selectedSummary.middleware_abnormal || 0}</div>
                        <div className="text-[10px] text-ds-muted">中间件异常</div>
                      </div>
                      <div className="text-center p-2 bg-ds-surface2 rounded-lg">
                        <div className="text-lg font-bold text-red-400">{selectedSummary.alert_s1 || 0}</div>
                        <div className="text-[10px] text-ds-muted">S1</div>
                      </div>
                      <div className="text-center p-2 bg-ds-surface2 rounded-lg">
                        <div className="text-lg font-bold text-orange-400">{selectedSummary.alert_s2 || 0}</div>
                        <div className="text-[10px] text-ds-muted">S2</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. 执行状态卡片 */}
                {(selectedReport.status === 'partial' || selectedReport.status === 'error' || selectedWarnings.length > 0 || selectedBlockResults.length > 0) && (
                  <div className="bg-ds-surface rounded-xl border border-ds-border p-5">
                    <h3 className="text-sm font-semibold text-ds-text mb-3">执行状态</h3>
                    <div className="flex items-center gap-2 mb-3">
                      <Badge status={selectedReport.status} />
                      {selectedReport.error_message && (
                        <span className="text-sm text-red-400">{selectedReport.error_message}</span>
                      )}
                    </div>
                    {selectedBlockResults.length > 0 && (
                      <div className="grid grid-cols-5 gap-2 mb-3">
                        {selectedBlockResults.map(br => (
                          <div key={br.block} className="text-center p-2 bg-ds-surface2 rounded-lg">
                            <div className="text-xs text-ds-muted mb-1 capitalize">{br.block}</div>
                            <div className="text-sm font-medium">{blockStatusIcon(br.status)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedFailedBlocks.length > 0 && (
                      <div className="text-sm text-red-400 mb-2">
                        失败区块：{selectedFailedBlocks.join('、')}
                      </div>
                    )}
                    {selectedWarnings.length > 0 && (
                      <div className="text-sm text-amber-400">
                        <div className="font-medium mb-1">警告：</div>
                        <ul className="list-disc list-inside space-y-0.5">
                          {selectedWarnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. 重点关注区块 */}
                {selectedHighlights.length > 0 && (
                  <div className="bg-ds-surface rounded-xl border border-ds-border p-5">
                    <h3 className="text-sm font-semibold text-ds-text mb-3">重点关注</h3>
                    <div className="space-y-2">
                      {selectedHighlights.map((h, i) => (
                        <div key={i} className={`flex items-start gap-2 p-2 rounded-lg ${
                          h.level === 'critical' ? 'bg-red-500/10' : 'bg-orange-500/10'
                        }`}>
                          <span className={`mt-0.5 text-xs font-bold px-1.5 py-0.5 rounded ${
                            h.level === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-orange-500/10 text-orange-400'
                          }`}>
                            {h.level === 'critical' ? '严重' : '警告'}
                          </span>
                          <div>
                            <div className="text-sm font-medium text-ds-text">{h.title}</div>
                            <div className="text-xs text-ds-muted">{h.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. 建议动作 */}
                {selectedSuggestions.length > 0 && (
                  <div className="bg-ds-surface rounded-xl border border-ds-border p-5">
                    <h3 className="text-sm font-semibold text-ds-text mb-3">建议动作</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm text-ds-muted">
                      {selectedSuggestions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 5. Markdown 内容 */}
                <div className="bg-ds-surface rounded-xl border border-ds-border overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-ds-border bg-ds-surface2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-ds-text">{selectedReport.project_name}</h3>
                      <span className="text-xs text-ds-muted">{selectedReport.report_date}</span>
                    </div>
                    <button
                      onClick={handleCopyMarkdown}
                      className="inline-flex items-center gap-1.5 text-sm text-ds-muted px-3 py-1.5 border border-ds-border rounded-lg hover:bg-ds-surface2 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      复制 Markdown
                    </button>
                  </div>
                  <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
                    <div className="prose prose-sm max-w-none prose-headings:text-ds-text prose-table:text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-ds-surface rounded-xl border border-ds-border flex items-center justify-center h-48">
                <div className="text-center text-ds-muted">
                  <svg className="w-10 h-10 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-sm">点击左侧报告查看详情</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
