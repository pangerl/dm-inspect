import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ChevronRight, Circle, Copy, FileText, Minus, Play, X } from 'lucide-react'
import { api } from '../api'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { safeParse, getYesterday, reportListSummary } from '../lib/utils'

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
  const [execDate, setExecDate] = useState(getYesterday)
  const pollTimerRef = useRef(null)
  const pendingCheckTimerRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    api.get('/projects')
      .then(data => { if (mountedRef.current) setProjectOptions(data || []) })
      .catch(() => {})
    return () => { mountedRef.current = false }
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
        if (!mountedRef.current) return data?.list || []
        setReports(data?.list || [])
        setTotal(data?.total || 0)
        return data?.list || []
      })
      .catch(err => {
        if (!mountedRef.current) throw err
        toast.error(err.message)
        throw err
      })
  }, [buildQuery, toast])

  const fetchReportsRef = useRef(fetchReports)
  useEffect(() => { fetchReportsRef.current = fetchReports }, [fetchReports])

  useEffect(() => {
    mountedRef.current = true
    setLoading(true)
    fetchReports().finally(() => { if (mountedRef.current) setLoading(false) })
    return () => {
      mountedRef.current = false
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
      clearTimeout(pendingCheckTimerRef.current)
      pendingCheckTimerRef.current = null
    }
  }, [fetchReports])

  useEffect(() => {
    const hasPending = reports.some(r => r.status === 'pending')
    if (!hasPending) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      return
    }
    if (pollTimerRef.current) return // 已有轮询不重复启动

    pollTimerRef.current = setInterval(() => {
      if (!mountedRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
        return
      }
      fetchReportsRef.current()
    }, 5000)

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [reports])

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
      if (!mountedRef.current) return
      setSelectedReport(detail)
      setMarkdown(md)
    } catch (err) {
      if (mountedRef.current) toast.error(err.message)
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

      // 执行后主动轮询，最多 5 次
      let attempts = 0
      const doPoll = () => {
        if (!mountedRef.current) return
        pendingCheckTimerRef.current = setTimeout(() => {
          if (!mountedRef.current) return
          fetchReportsRef.current().then(data => {
            if (!mountedRef.current) return
            const hasPending = (data || []).some(r => r.status === 'pending')
            attempts++
            if (hasPending && attempts < 5) {
              doPoll()
            }
          }).catch(() => {
            // 错误时停止轮询
          })
        }, attempts === 0 ? 2000 : 5000)
      }
      doPoll()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setExecutingProject(false)
    }
  }

  // 解析选中报告的扩展字段（用 useMemo 避免每次渲染重复解析）
  // ⚠️ 必须在所有 hook 之后才能使用条件 return，因此放在此处
  const selectedSummary = useMemo(() => selectedReport ? safeParse(selectedReport.summary, {}) : {}, [selectedReport])
  const selectedFailedBlocks = useMemo(() => selectedReport ? safeParse(selectedReport.failed_blocks, []) : [], [selectedReport])
  const selectedWarnings = useMemo(() => selectedReport ? safeParse(selectedReport.warnings, []) : [], [selectedReport])
  const selectedBlockResults = useMemo(() => selectedReport ? safeParse(selectedReport.block_results, []) : [], [selectedReport])
  const selectedHighlights = useMemo(() => selectedReport ? safeParse(selectedReport.highlights, []) : [], [selectedReport])
  const selectedSuggestions = useMemo(() => selectedReport ? safeParse(selectedReport.suggestions, []) : [], [selectedReport])

  const blockStatusIcon = (status) => {
    if (status === 'success') return <Check className="w-4 h-4 text-ds-accent" />
    if (status === 'failed') return <X className="w-4 h-4 text-red-500" />
    if (status === 'skipped') return <Minus className="w-4 h-4 text-ds-muted" />
    return <Circle className="w-4 h-4 text-ds-muted" />
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

  if (loading) return <Spinner />

  const selectedProject = projectOptions.find(p => String(p.id) === filterProject)

  return (
    <div>
      {/* 页面头 */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-ds-text tracking-tight-apple">巡检报告</h1>
          <p className="text-sm text-ds-muted mt-1 leading-relaxed">
            查看巡检结果、执行状态和异常摘要
            {Array.isArray(reports) && reports.some(r => r?.status === 'pending') && (
              <span className="ml-2 text-amber-600 dark:text-amber-400 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
                有任务进行中，每5秒自动刷新
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {filterProject && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={execDate}
                onChange={e => setExecDate(e.target.value)}
                className="px-3 py-2 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent transition-all"
              />
              <Button
                onClick={handleExecuteForProject}
                disabled={executingProject}
                className="inline-flex items-center gap-1.5"
              >
                {executingProject ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {executingProject ? '启动中' : '执行巡检'}
              </Button>
            </div>
          )}
          <select
            value={filterProject}
            onChange={e => updateFilters({ project_id: e.target.value })}
            className="px-3 py-2 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent transition-all"
          >
            <option value="">全部项目</option>
            {projectOptions.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => updateFilters({ status: e.target.value })}
            className="px-3 py-2 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent transition-all"
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
            className="px-3 py-2 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent transition-all"
          />
        </div>
      </div>

      {reports.length === 0 ? (
        <EmptyState
          title="暂无报告"
          description={filterProject ? `「${selectedProject?.name}」尚未执行过巡检` : '请先前往项目管理执行巡检'}
          action={
            filterProject ? (
              <Button
                onClick={handleExecuteForProject}
                disabled={executingProject}
              >
                立即执行巡检
              </Button>
            ) : (
              <Link to="/projects"
                className="inline-flex items-center gap-1.5"
              >
                <Button>前往巡检项目</Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* 报告列表（左侧） */}
          <div className="lg:col-span-2 bg-ds-surface rounded-[18px] border border-ds-border overflow-hidden self-start">
            {/* 桌面端表格 */}
            <div className="hidden md:block">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-ds-border bg-ds-surface2">
                    <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">项目</th>
                    <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">日期</th>
                    <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">状态</th>
                    <th className="px-5 py-3.5 w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ds-border">
                  {reports.map(r => (
                    <tr
                      key={r.id}
                      className={`cursor-pointer hover:bg-ds-surface2 transition-colors ${
                        selectedReport?.id === r.id ? 'bg-ds-accent/5 hover:bg-ds-accent/5' : ''
                      }`}
                      onClick={() => handleViewReport(r)}
                    >
                      <td className="px-5 py-4">
                        <div className="font-medium text-ds-text">{r.project_name}</div>
                        <div className="text-xs text-ds-muted mt-0.5">{reportListSummary(r)}</div>
                      </td>
                      <td className="px-5 py-4 text-ds-muted whitespace-nowrap">{r.report_date}</td>
                      <td className="px-5 py-4">
                        <Badge status={r.status} />
                      </td>
                      <td className="px-5 py-4 text-right">
                        <ChevronRight className={`w-4 h-4 inline-block transition-colors ${selectedReport?.id === r.id ? 'text-ds-accent' : 'text-ds-muted'}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 移动端卡片 */}
            <div className="md:hidden divide-y divide-ds-border">
              {reports.map(r => (
                <div
                  key={r.id}
                  className={`cursor-pointer p-5 transition-colors ${
                    selectedReport?.id === r.id ? 'bg-ds-accent/5' : 'hover:bg-ds-surface2'
                  }`}
                  onClick={() => handleViewReport(r)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-ds-text">{r.project_name}</div>
                      <div className="text-xs text-ds-muted mt-0.5">{r.report_date}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge status={r.status} />
                      <ChevronRight className={`w-4 h-4 transition-colors ${selectedReport?.id === r.id ? 'text-ds-accent' : 'text-ds-muted'}`} />
                    </div>
                  </div>
                  <div className="text-xs text-ds-muted mt-1 truncate">{reportListSummary(r)}</div>
                </div>
              ))}
            </div>

            {/* 分页 */}
            {total > pageSize && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-ds-border">
                <div className="text-xs text-ds-muted">
                  共 {total} 条，第 {page} / {Math.ceil(total / pageSize)} 页
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-2.5 py-1 text-xs rounded-lg border border-ds-border text-ds-muted hover:bg-ds-surface2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                          className={`w-7 h-7 text-xs rounded-lg border transition-colors ${
                            p === page
                              ? 'bg-ds-accent border-ds-accent text-white'
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
                    className="px-2.5 py-1 text-xs rounded-lg border border-ds-border text-ds-muted hover:bg-ds-surface2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                  <div className="bg-ds-surface rounded-[18px] border border-ds-border p-5">
                    <h3 className="text-sm font-semibold text-ds-text mb-4">巡检摘要</h3>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                      <div className="text-center p-3 bg-ds-surface2 rounded-xl">
                        <div className="text-lg font-bold text-ds-text">{selectedSummary.offline_servers || 0}</div>
                        <div className="text-[10px] text-ds-muted mt-0.5">离线</div>
                      </div>
                      <div className="text-center p-3 bg-ds-surface2 rounded-xl">
                        <div className="text-lg font-bold text-ds-text">{selectedSummary.clock_offset_issues || 0}</div>
                        <div className="text-[10px] text-ds-muted mt-0.5">时间偏移</div>
                      </div>
                      <div className="text-center p-3 bg-ds-surface2 rounded-xl">
                        <div className="text-lg font-bold text-ds-text">{selectedSummary.disk_critical || 0}</div>
                        <div className="text-[10px] text-ds-muted mt-0.5">磁盘风险</div>
                      </div>
                      <div className="text-center p-3 bg-ds-surface2 rounded-xl">
                        <div className="text-lg font-bold text-ds-text">{selectedSummary.middleware_abnormal || 0}</div>
                        <div className="text-[10px] text-ds-muted mt-0.5">中间件异常</div>
                      </div>
                      <div className="text-center p-3 bg-ds-surface2 rounded-xl">
                        <div className="text-lg font-bold text-red-500">{selectedSummary.alert_s1 || 0}</div>
                        <div className="text-[10px] text-ds-muted mt-0.5">S1</div>
                      </div>
                      <div className="text-center p-3 bg-ds-surface2 rounded-xl">
                        <div className="text-lg font-bold text-orange-500">{selectedSummary.alert_s2 || 0}</div>
                        <div className="text-[10px] text-ds-muted mt-0.5">S2</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. 执行状态卡片 */}
                {(selectedReport.status === 'partial' || selectedReport.status === 'error' || selectedWarnings.length > 0 || selectedBlockResults.length > 0) && (
                  <div className="bg-ds-surface rounded-[18px] border border-ds-border p-5">
                    <h3 className="text-sm font-semibold text-ds-text mb-4">执行状态</h3>
                    <div className="flex items-center gap-2 mb-4">
                      <Badge status={selectedReport.status} />
                      {selectedReport.error_message && (
                        <span className="text-sm text-red-500">{selectedReport.error_message}</span>
                      )}
                    </div>
                    {selectedBlockResults.length > 0 && (
                      <div className="grid grid-cols-5 gap-2 mb-4">
                        {selectedBlockResults.map(br => (
                          <div key={br.block} className="text-center p-2 bg-ds-surface2 rounded-xl">
                            <div className="text-xs text-ds-muted mb-1 capitalize">{br.block}</div>
                            <div className="text-sm font-medium">{blockStatusIcon(br.status)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedFailedBlocks.length > 0 && (
                      <div className="text-sm text-red-500 mb-2">
                        失败区块：{selectedFailedBlocks.join('、')}
                      </div>
                    )}
                    {selectedWarnings.length > 0 && (
                      <div className="text-sm text-amber-600 dark:text-amber-400">
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
                  <div className="bg-ds-surface rounded-[18px] border border-ds-border p-5">
                    <h3 className="text-sm font-semibold text-ds-text mb-4">重点关注</h3>
                    <div className="space-y-2">
                      {selectedHighlights.map((h, i) => (
                        <div key={i} className={`flex items-start gap-2 p-3 rounded-xl ${
                          h.level === 'critical' ? 'bg-red-500/5' : 'bg-orange-500/5'
                        }`}>
                          <span className={`mt-0.5 text-xs font-bold px-2 py-0.5 rounded-full ${
                            h.level === 'critical' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
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
                  <div className="bg-ds-surface rounded-[18px] border border-ds-border p-5">
                    <h3 className="text-sm font-semibold text-ds-text mb-4">建议动作</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm text-ds-muted">
                      {selectedSuggestions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 5. Markdown 内容 */}
                <div className="bg-ds-surface rounded-[18px] border border-ds-border overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-ds-border bg-ds-surface2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-ds-text">{selectedReport.project_name}</h3>
                      <span className="text-xs text-ds-muted">{selectedReport.report_date}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyMarkdown}
                      className="inline-flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      复制 Markdown
                    </Button>
                  </div>
                  <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-ds-surface rounded-[18px] border border-ds-border flex items-center justify-center h-48">
                <div className="text-center text-ds-muted">
                  <FileText className="w-10 h-10 mx-auto mb-2" strokeWidth={1.5} />
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
