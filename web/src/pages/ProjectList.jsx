import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Zap, Plus, Pencil, Trash2 } from 'lucide-react'
import { api } from '../api'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getYesterday, formatSummary } from '../lib/utils'

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
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ds-text tracking-tight-apple">巡检项目</h1>
          <p className="text-sm text-ds-muted mt-1 leading-relaxed">管理巡检范围、执行巡检并查看最近结果</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <Button asChild>
            <Link to="/projects/quick-new" className="inline-flex items-center gap-1.5">
              <Zap className="w-4 h-4" />
              使用预设快速创建
            </Link>
          </Button>
          <Button variant="outline" asChild>
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
              <Button asChild>
                <Link to="/projects/quick-new">使用预设快速创建</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/templates">进入模板管理</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="hidden md:block bg-ds-surface rounded-[18px] border border-ds-border overflow-hidden">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-ds-border bg-ds-surface2">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">项目名称</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">模板</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">Group</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">最近巡检</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">最近状态</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">最近异常摘要</th>
                  <th className="px-5 py-3.5 w-56" />
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
                      <td className="px-5 py-4 font-medium text-ds-text">{p.name}</td>
                      <td className="px-5 py-4 text-ds-muted">{p.template_name}</td>
                      <td className="px-5 py-4">
                        <span className="inline-block bg-ds-surface2 text-ds-muted text-xs px-2.5 py-1 rounded-full font-mono">
                          {vars.group || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-ds-muted">{lr?.report_date || '—'}</td>
                      <td className="px-5 py-4">{lr?.status ? <Badge status={lr.status} /> : '—'}</td>
                      <td className="px-5 py-4 text-ds-muted max-w-xs truncate" title={formatSummary(lr)}>
                        {formatSummary(lr)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <div className="flex flex-col items-end gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="date"
                                value={execDates[p.id] || getYesterday()}
                                onChange={e => setExecDates(prev => ({ ...prev, [p.id]: e.target.value }))}
                                className="px-2.5 py-1.5 border border-ds-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ds-accent transition-all"
                              />
                              <Button
                                size="sm"
                                onClick={() => handleExecute(p)}
                                disabled={isExecuting}
                                className="h-8 px-3 text-xs disabled:opacity-60"
                              >
                                {isExecuting ? '启动中' : '执行巡检'}
                              </Button>
                            </div>
                            <span className="text-[10px] text-ds-muted">默认生成昨日巡检报告，可修改日期</span>
                          </div>
                          <Button variant="ghost" size="sm" asChild
                            className="text-ds-accent hover:text-ds-accent hover:bg-ds-accent/10 h-8 px-2"
                          >
                            <Link to={`/projects/${p.id}/edit`}>
                              <Pencil className="w-3.5 h-3.5 mr-1" />
                              编辑
                            </Link>
                          </Button>
                          {confirmId === p.id ? (
                            <span className="flex items-center gap-1">
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDelete(p.id)}
                                className="h-8 px-2 text-xs"
                              >
                                确认
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmId(null)}
                                className="h-8 px-2 text-xs"
                              >
                                取消
                              </Button>
                            </span>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmId(p.id)}
                              className="text-red-500 hover:text-red-600 hover:bg-red-500/10 h-8 px-2"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" />
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
                <Card key={p.id} className="bg-ds-surface border-ds-border rounded-[18px]">
                  <CardHeader className="p-5 pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base text-ds-text font-medium">{p.name}</CardTitle>
                      {lr?.status && <Badge status={lr.status} />}
                    </div>
                    <CardDescription className="text-xs text-ds-muted flex items-center gap-2 mt-1.5">
                      <span className="font-mono bg-ds-surface2 px-2 py-0.5 rounded-full">{vars.group || '—'}</span>
                      <span>{p.template_name}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-5 pt-0 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ds-muted">最近巡检</span>
                      <span className="text-ds-text">{lr?.report_date || '—'}</span>
                    </div>
                    {lr && (
                      <div className="text-xs text-ds-muted truncate" title={formatSummary(lr)}>
                        {formatSummary(lr)}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-3 border-t border-ds-border">
                      <input
                        type="date"
                        value={execDates[p.id] || getYesterday()}
                        onChange={e => setExecDates(prev => ({ ...prev, [p.id]: e.target.value }))}
                        className="flex-1 px-2.5 py-1.5 border border-ds-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ds-accent transition-all"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleExecute(p)}
                        disabled={isExecuting}
                        className="h-8 px-3 text-xs disabled:opacity-60 whitespace-nowrap"
                      >
                        {isExecuting ? '启动中' : '执行巡检'}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" asChild
                        className="text-ds-accent hover:text-ds-accent hover:bg-ds-accent/10 h-8 px-2 flex-1"
                      >
                        <Link to={`/projects/${p.id}/edit`}>
                          <Pencil className="w-3.5 h-3.5 mr-1" />
                          编辑
                        </Link>
                      </Button>
                      {confirmId === p.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(p.id)}
                            className="h-8 px-2 text-xs flex-1"
                          >
                            确认删除
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmId(null)}
                            className="h-8 px-2 text-xs flex-1"
                          >
                            取消
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmId(p.id)}
                          className="text-red-500 hover:text-red-600 hover:bg-red-500/10 h-8 px-2 flex-1"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
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
