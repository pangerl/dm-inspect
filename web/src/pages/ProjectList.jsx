import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'

// 从最近报告生成简短异常摘要，按状态优先级处理
function formatSummary(lr) {
  if (!lr) return '—'

  // 1. error 状态优先显示错误信息
  if (lr.status === 'error') {
    return lr.error_message || '巡检执行失败'
  }

  // 2. partial 状态优先显示失败区块
  if (lr.status === 'partial') {
    try {
      const failed = JSON.parse(lr.failed_blocks)
      if (Array.isArray(failed) && failed.length > 0) {
        return `${failed.join('、')} 查询失败`
      }
    } catch { /* ignore */ }
    return '部分区块执行失败'
  }

  // 3. completed 状态显示 summary 归纳
  if (!lr.summary || lr.summary === '') return '无异常'
  try {
    const s = JSON.parse(lr.summary)
    const parts = []
    if (s.offline_servers > 0) parts.push(`${s.offline_servers}台离线`)
    if (s.disk_critical > 0) parts.push(`${s.disk_critical}项磁盘风险`)
    if (s.middleware_abnormal > 0) parts.push(`${s.middleware_abnormal}个中间件异常`)
    if (s.alert_s1 + s.alert_s2 > 0) parts.push(`S1/S2告警${s.alert_s1 + s.alert_s2}条`)
    return parts.length > 0 ? parts.join('，') : '无异常'
  } catch {
    return '—'
  }
}

// 获取昨天的日期字符串 YYYY-MM-DD
function getYesterday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

export default function ProjectList() {
  const toast = useToast()
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmId, setConfirmId] = useState(null)
  const [executingId, setExecutingId] = useState(null)
  const [execDates, setExecDates] = useState({}) // project_id -> date

  const fetchProjects = () =>
    api.get('/projects')
      .then(data => setProjects(data || []))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))

  useEffect(() => { fetchProjects() }, [])

  const handleExecute = async (project) => {
    const reportDate = execDates[project.id] || getYesterday()
    setExecutingId(project.id)
    try {
      await api.post('/executions', { project_id: project.id, report_date: reportDate })
      toast.success(`「${project.name}」${reportDate} 巡检已启动`)
      navigate(`/reports?project_id=${project.id}`)
    } catch (err) {
      toast.error(err.message)
      setExecutingId(null)
    }
  }

  const handleDelete = async (id) => {
    try {
      await api.del(`/projects/${id}`)
      setProjects(prev => prev.filter(p => p.id !== id))
      toast.success('项目已删除')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setConfirmId(null)
    }
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-ds-text">巡检项目</h1>
          <p className="text-sm text-ds-muted mt-0.5">管理巡检范围、执行巡检并查看最近结果</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/projects/quick-new"
            className="inline-flex items-center gap-1.5 bg-ds-accent text-ds-text text-sm font-medium px-4 py-2 rounded-lg hover:bg-ds-accent-hover transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            使用预设快速创建
          </Link>
          <Link
            to="/projects/new"
            className="inline-flex items-center gap-1.5 bg-ds-surface text-ds-muted border border-ds-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-ds-surface2 transition-colors"
          >
            高级创建项目
          </Link>
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="还没有巡检项目"
          description="推荐先用预设快速创建，3 分钟内完成首个巡检"
          action={
            <div className="flex items-center gap-2">
              <Link to="/projects/quick-new"
                className="inline-flex items-center gap-1.5 bg-ds-accent text-ds-text text-sm font-medium px-4 py-2 rounded-lg hover:bg-ds-accent-hover transition-colors"
              >
                使用预设快速创建
              </Link>
              <Link to="/templates"
                className="inline-flex items-center gap-1.5 bg-ds-surface text-ds-muted border border-ds-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-ds-surface2 transition-colors"
              >
                进入模板管理
              </Link>
            </div>
          }
        />
      ) : (
        <div className="bg-ds-surface rounded-xl border border-ds-border overflow-hidden">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-ds-border bg-ds-surface2">
                <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider">项目名称</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider">模板</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider">Group</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider">最近巡检</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider">最近状态</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider">最近异常摘要</th>
                <th className="px-4 py-3 w-56" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ds-border">
              {projects.map(p => {
                let vars = {}
                try { vars = JSON.parse(p.variables) } catch {}
                const isExecuting = executingId === p.id
                const lr = p.latest_report
                return (
                  <tr key={p.id} className="hover:bg-ds-surface2 transition-colors">
                    <td className="px-4 py-3 font-medium text-ds-text">{p.name}</td>
                    <td className="px-4 py-3 text-ds-muted">{p.template_name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block bg-ds-surface2 text-ds-muted text-xs px-2 py-0.5 rounded font-mono">
                        {vars.group || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ds-muted">
                      {lr?.report_date || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {lr?.status ? <Badge status={lr.status} /> : '—'}
                    </td>
                    <td className="px-4 py-3 text-ds-muted max-w-xs truncate" title={formatSummary(lr)}>
                      {formatSummary(lr)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="date"
                              value={execDates[p.id] || getYesterday()}
                              onChange={e => setExecDates(prev => ({ ...prev, [p.id]: e.target.value }))}
                              className="px-2 py-1 border border-ds-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ds-accent"
                            />
                            <button
                              onClick={() => handleExecute(p)}
                              disabled={isExecuting}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-ds-accent text-ds-text rounded text-xs font-medium hover:bg-ds-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                            >
                              {isExecuting ? (
                                <span className="w-3 h-3 border-2 border-ds-text border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              )}
                              {isExecuting ? '启动中' : '执行巡检'}
                            </button>
                          </div>
                          <span className="text-[10px] text-ds-muted">默认生成昨日巡检报告，可修改日期</span>
                        </div>
                        <Link
                          to={`/projects/${p.id}/edit`}
                          className="inline-flex items-center gap-1 px-2 py-1 text-ds-accent hover:bg-ds-accent/10 rounded text-xs font-medium transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          编辑
                        </Link>
                        {confirmId === p.id ? (
                          <span className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(p.id)}
                              className="px-2 py-1 text-xs font-medium bg-red-500 text-ds-text rounded hover:bg-red-600 transition-colors"
                            >
                              确认
                            </button>
                            <button
                              onClick={() => setConfirmId(null)}
                              className="px-2 py-1 text-xs font-medium text-ds-muted hover:bg-ds-surface2 rounded transition-colors"
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmId(p.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-red-400 hover:bg-red-500/10 rounded text-xs font-medium transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            删除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
