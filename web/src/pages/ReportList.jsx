import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'

export default function ReportList() {
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // 从 URL 读取初始筛选项（配合项目列表跳转）
  const [filterProject, setFilterProject] = useState(searchParams.get('project_id') || '')
  const [projectOptions, setProjectOptions] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedReport, setSelectedReport] = useState(null)
  const [markdown, setMarkdown] = useState('')
  const [executingProject, setExecutingProject] = useState(false)
  const pollTimerRef = useRef(null)

  // 独立加载项目列表（修复：过滤器选项与报告列表解耦）
  useEffect(() => {
    api.get('/projects')
      .then(data => setProjectOptions(data || []))
      .catch(() => {}) // 过滤器加载失败不影响主流程
  }, [])

  const fetchReports = () => {
    const url = filterProject ? `/reports?project_id=${filterProject}` : '/reports'
    return api.get(url)
      .then(data => {
        setReports(data || [])
        return data || []
      })
      .catch(err => {
        toast.error(err.message)
        return []
      })
  }

  // filterProject 变化时：重新加载，并清掉旧的轮询
  useEffect(() => {
    setLoading(true)
    fetchReports().finally(() => setLoading(false))
    return () => {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [filterProject])

  // reports 变化时：有 pending 就保持轮询，全部完成就停
  // 这样无论通过何种方式（初始加载、手动触发）出现 pending 报告，都能自动开启轮询
  useEffect(() => {
    const hasPending = reports.some(r => r.status === 'pending')
    if (hasPending && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(fetchReports, 5000)
    } else if (!hasPending && pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [reports])

  // 同步 filterProject 到 URL
  const handleFilterChange = (val) => {
    setFilterProject(val)
    setSelectedReport(null)
    if (val) {
      setSearchParams({ project_id: val })
    } else {
      setSearchParams({})
    }
  }

  const handleViewReport = async (report) => {
    try {
      const md = await api.get(`/reports/${report.id}/markdown`)
      setMarkdown(md)
      setSelectedReport(report)
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
      await api.post('/executions', { project_id: projectId })
      const proj = projectOptions.find(p => p.id === projectId)
      toast.success(`「${proj?.name || ''}」巡检已启动`)
      // 延迟 1s 再拉取，等待后端异步 goroutine 创建报告记录
      setTimeout(fetchReports, 1000)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setExecutingProject(false)
    }
  }

  if (loading) return <Spinner />

  const selectedProject = projectOptions.find(p => String(p.id) === filterProject)

  return (
    <div>
      {/* 页面头 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">巡检报告</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            查看历史巡检结果
            {reports.some(r => r.status === 'pending') && (
              <span className="ml-2 text-yellow-600 inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse inline-block" />
                进行中，每 5 秒自动刷新
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {filterProject && (
            <button
              onClick={handleExecuteForProject}
              disabled={executingProject}
              className="inline-flex items-center gap-1.5 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
            >
              {executingProject ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {executingProject ? '启动中' : `执行巡检`}
            </button>
          )}
          <select
            value={filterProject}
            onChange={e => handleFilterChange(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全部项目</option>
            {projectOptions.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
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
                className="inline-flex items-center gap-1.5 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
              >
                立即执行巡检
              </button>
            ) : (
              <Link to="/projects"
                className="inline-flex items-center gap-1.5 bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                前往项目管理
              </Link>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* 报告列表（左侧） */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden self-start">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">项目</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">日期</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reports.map(r => (
                  <tr
                    key={r.id}
                    className={`cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedReport?.id === r.id ? 'bg-blue-50 hover:bg-blue-50' : ''
                    }`}
                    onClick={() => r.status === 'completed' && handleViewReport(r)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 truncate max-w-[120px]">{r.project_name}</td>
                    <td className="px-4 py-3 text-gray-500">{r.report_date}</td>
                    <td className="px-4 py-3">
                      <Badge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.status === 'completed' && (
                        <svg className={`w-4 h-4 inline-block transition-colors ${selectedReport?.id === r.id ? 'text-blue-500' : 'text-gray-300'}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 报告详情（右侧） */}
          <div className="lg:col-span-3">
            {selectedReport ? (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* 详情头 */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
                  <div>
                    <h2 className="font-semibold text-gray-900">{selectedReport.project_name}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{selectedReport.report_date}</p>
                  </div>
                  <button
                    onClick={handleCopyMarkdown}
                    className="inline-flex items-center gap-1.5 text-sm text-gray-600 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    复制 Markdown
                  </button>
                </div>

                {/* Markdown 预览 */}
                <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">报告内容</h3>
                  <div className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-table:text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 flex items-center justify-center h-48">
                <div className="text-center text-gray-400">
                  <svg className="w-10 h-10 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-sm">点击左侧已完成的报告查看详情</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
