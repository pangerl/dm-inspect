import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

function formatSummary(lr) {
  if (!lr) return '—'
  if (lr.status === 'error') return lr.error_message || '巡检执行失败'
  if (lr.status === 'partial') {
    try {
      const failed = JSON.parse(lr.failed_blocks)
      if (Array.isArray(failed) && failed.length > 0) return `${failed.join('、')} 查询失败`
    } catch { /* ignore */ }
    return '部分区块执行失败'
  }
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
  const [execDates, setExecDates] = useState({})

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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ds-text">巡检项目</h1>
          <p className="text-sm text-ds-muted mt-0.5">管理巡检范围、执行巡检并查看最近结果</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <Button asChild className="bg-ds-accent hover:bg-ds-accent-hover text-ds-text">
            <Link to="/projects/quick-new" className="inline-flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              使用预设快速创建
            </Link>
          </Button>
          <Button variant="outline" asChild className="border-ds-border text-ds-muted hover:bg-ds-surface2 hover:text-ds-text">
            <Link to="/projects/new">高级创建项目</Link>
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="还没有巡检项目"
          description="推荐先用预设快速创建，3 分钟内完成首个巡检"
          action={
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <Button asChild className="bg-ds-accent hover:bg-ds-accent-hover text-ds-text">
                <Link to="/projects/quick-new">使用预设快速创建</Link>
              </Button>
              <Button variant="outline" asChild className="border-ds-border text-ds-muted hover:bg-ds-surface2 hover:text-ds-text">
                <Link to="/templates">进入模板管理</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="hidden md:block bg-ds-surface rounded-xl border border-ds-border overflow-hidden">
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
                      <td className="px-4 py-3 text-ds-muted">{lr?.report_date || '—'}</td>
                      <td className="px-4 py-3">{lr?.status ? <Badge status={lr.status} /> : '—'}</td>
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
                              <Button
                                size="sm"
                                onClick={() => handleExecute(p)}
                                disabled={isExecuting}
                                className="bg-ds-accent hover:bg-ds-accent-hover text-ds-text h-7 px-2.5 text-xs disabled:opacity-60"
                              >
                                {isExecuting ? '启动中' : '执行巡检'}
                              </Button>
                            </div>
                            <span className="text-[10px] text-ds-muted">默认生成昨日巡检报告，可修改日期</span>
                          </div>
                          <Button variant="ghost" size="sm" asChild
                            className="text-ds-accent hover:text-ds-accent hover:bg-ds-accent/10 h-7 px-2"
                          >
                            <Link to={`/projects/${p.id}/edit`}>编辑</Link>
                          </Button>
                          {confirmId === p.id ? (
                            <span className="flex items-center gap-1">
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDelete(p.id)}
                                className="h-7 px-2 text-xs"
                              >
                                确认
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmId(null)}
                                className="h-7 px-2 text-xs"
                              >
                                取消
                              </Button>
                            </span>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmId(p.id)}
                              className="text-red-400 hover:text-red-400 hover:bg-red-500/10 h-7 px-2"
                            >
                              删除
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片 */}
          <div className="md:hidden space-y-3">
            {projects.map(p => {
              let vars = {}
              try { vars = JSON.parse(p.variables) } catch {}
              const isExecuting = executingId === p.id
              const lr = p.latest_report
              return (
                <Card key={p.id} className="bg-ds-surface border-ds-border">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base text-ds-text">{p.name}</CardTitle>
                      {lr?.status && <Badge status={lr.status} />}
                    </div>
                    <CardDescription className="text-xs text-ds-muted flex items-center gap-2 mt-1">
                      <span className="font-mono bg-ds-surface2 px-1.5 py-0.5 rounded">{vars.group || '—'}</span>
                      <span>{p.template_name}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-2 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ds-muted">最近巡检</span>
                      <span className="text-ds-text">{lr?.report_date || '—'}</span>
                    </div>
                    {lr && (
                      <div className="text-xs text-ds-muted truncate" title={formatSummary(lr)}>
                        {formatSummary(lr)}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-2 border-t border-ds-border">
                      <input
                        type="date"
                        value={execDates[p.id] || getYesterday()}
                        onChange={e => setExecDates(prev => ({ ...prev, [p.id]: e.target.value }))}
                        className="flex-1 px-2 py-1 border border-ds-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ds-accent"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleExecute(p)}
                        disabled={isExecuting}
                        className="bg-ds-accent hover:bg-ds-accent-hover text-ds-text h-7 px-2.5 text-xs disabled:opacity-60 whitespace-nowrap"
                      >
                        {isExecuting ? '启动中' : '执行巡检'}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" asChild
                        className="text-ds-accent hover:text-ds-accent hover:bg-ds-accent/10 h-7 px-2 flex-1"
                      >
                        <Link to={`/projects/${p.id}/edit`}>编辑</Link>
                      </Button>
                      {confirmId === p.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(p.id)}
                            className="h-7 px-2 text-xs flex-1"
                          >
                            确认删除
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmId(null)}
                            className="h-7 px-2 text-xs flex-1"
                          >
                            取消
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmId(p.id)}
                          className="text-red-400 hover:text-red-400 hover:bg-red-500/10 h-7 px-2 flex-1"
                        >
                          删除
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
