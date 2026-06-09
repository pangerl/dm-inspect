import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, Clock, Pencil, Trash2, Plus, X } from 'lucide-react'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

const TYPE_LABELS = {
  daily: '每日巡检',
  monthly: '月度巡检',
  quarterly: '季度巡检',
  yearly: '年度巡检',
}

export default function ScheduleList() {
  const toast = useToast()
  const [schedules, setSchedules] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [logModal, setLogModal] = useState(null)

  const load = () => {
    setLoading(true)
    Promise.all([
      api.get('/schedules'),
      api.get('/projects'),
    ])
      .then(([sData, pData]) => {
        setSchedules(sData || [])
        setProjects(pData || [])
      })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleDelete = (id) => {
    if (!confirm('确定删除该定时任务？')) return
    api.del(`/schedules/${id}`)
      .then(() => {
        toast.success('已删除')
        load()
      })
      .catch(err => toast.error(err.message))
  }

  const handleRun = (id) => {
    api.post(`/schedules/${id}/run`)
      .then(() => toast.success('巡检已触发'))
      .catch(err => toast.error(err.message))
  }

  const openLogs = (id, projectId) => {
    setLogModal({ scheduleId: id, projectId, logs: [], loading: true })
    api.get(`/schedules/${id}/logs`)
      .then(data => {
        setLogModal(prev => ({ ...prev, logs: data || [], loading: false }))
      })
      .catch(err => {
        toast.error(err.message)
        setLogModal(prev => ({ ...prev, loading: false }))
      })
  }

  const getProjectName = (pid) => {
    const p = projects.find(x => x.id === pid)
    return p ? p.name : `项目${pid}`
  }

  const formatNextRun = (t) => {
    if (!t) return '-'
    const d = new Date(t)
    const now = new Date()
    const diff = d - now
    if (diff < 0) return '即将执行'
    const hours = Math.floor(diff / 3600000)
    const mins = Math.floor((diff % 3600000) / 60000)
    if (hours > 0) return `${hours}小时${mins}分钟后`
    return `${mins}分钟后`
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ds-text tracking-tight-apple">定时任务</h1>
          <p className="text-sm text-ds-muted mt-1 leading-relaxed">配置自动巡检计划，支持邮件、企业微信和飞书通知</p>
        </div>
        <Button asChild>
          <Link to="/schedules/new" className="inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" />
            新建任务
          </Link>
        </Button>
      </div>

      {schedules.length === 0 ? (
        <div className="bg-ds-surface rounded-[18px] border border-ds-border p-12 text-center">
          <p className="text-ds-muted mb-3">暂无定时任务</p>
          <Link to="/schedules/new" className="text-ds-accent text-sm hover:underline inline-flex items-center gap-1">
            创建一个定时巡检任务
          </Link>
        </div>
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="hidden md:block bg-ds-surface rounded-[18px] border border-ds-border overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-ds-surface2 text-ds-muted">
                <tr>
                  <th className="text-left px-5 py-3.5 font-medium">任务名称</th>
                  <th className="text-left px-5 py-3.5 font-medium">关联项目</th>
                  <th className="text-left px-5 py-3.5 font-medium">Cron 表达式</th>
                  <th className="text-left px-5 py-3.5 font-medium">类型</th>
                  <th className="text-left px-5 py-3.5 font-medium">状态</th>
                  <th className="text-left px-5 py-3.5 font-medium">下次执行</th>
                  <th className="text-left px-5 py-3.5 font-medium">通知配置</th>
                  <th className="text-right px-5 py-3.5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ds-border">
                {schedules.map(s => (
                  <tr key={s.id} className="hover:bg-ds-surface2 transition-colors">
                    <td className="px-5 py-4 font-medium text-ds-text">{s.name}</td>
                    <td className="px-5 py-4 text-ds-muted">{getProjectName(s.project_id)}</td>
                    <td className="px-5 py-4 font-mono text-ds-muted text-xs">{s.cron}</td>
                    <td className="px-5 py-4 text-ds-muted">{TYPE_LABELS[s.inspection_type] || s.inspection_type}</td>
                    <td className="px-5 py-4">
                      {s.enabled ? (
                        <span className="inline-flex items-center gap-1.5 text-ds-accent text-xs font-medium">
                          <span className="w-2 h-2 rounded-full bg-ds-accent" />
                          启用
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-ds-muted text-xs">
                          <span className="w-2 h-2 rounded-full bg-ds-border" />
                          禁用
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-ds-muted text-xs">
                      {s.enabled ? formatNextRun(s.next_run) : '-'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="space-y-1">
                        <div className="text-xs text-ds-muted">
                          {s.notification_config_name || '不通知'}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {s.notify_email && (
                            <span className="text-xs bg-ds-surface2 text-ds-muted px-2 py-0.5 rounded-full border border-ds-border" title={s.notify_email}>
                              邮件
                            </span>
                          )}
                          {s.notify_wechat && (
                            <span className="text-xs bg-ds-accent/10 text-ds-accent px-2 py-0.5 rounded-full" title="企业微信">
                              微信
                            </span>
                          )}
                          {s.notify_feishu && (
                            <span className="text-xs bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full" title="飞书">
                              飞书
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleRun(s.id)}
                          className="text-ds-muted hover:text-ds-accent h-8 w-8"
                          title="立即执行"
                        >
                          <Play className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openLogs(s.id, s.project_id)}
                          className="text-ds-muted hover:text-ds-accent h-8 w-8"
                          title="执行历史"
                        >
                          <Clock className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" asChild
                          className="text-ds-muted hover:text-ds-accent h-8 w-8"
                          title="编辑"
                        >
                          <Link to={`/schedules/${s.id}/edit`}>
                            <Pencil className="w-4 h-4" />
                          </Link>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(s.id)}
                          className="text-ds-muted hover:text-red-500 h-8 w-8"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片 */}
          <div className="md:hidden space-y-3">
            {schedules.map(s => (
              <Card key={s.id} className="bg-ds-surface border-ds-border rounded-[18px]">
                <CardHeader className="p-5 pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base text-ds-text font-medium">{s.name}</CardTitle>
                    {s.enabled ? (
                      <span className="inline-flex items-center gap-1.5 text-ds-accent text-xs font-medium">
                        <span className="w-2 h-2 rounded-full bg-ds-accent" />
                        启用
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-ds-muted text-xs">
                        <span className="w-2 h-2 rounded-full bg-ds-border" />
                        禁用
                      </span>
                    )}
                  </div>
                  <CardDescription className="text-xs text-ds-muted mt-1">
                    {getProjectName(s.project_id)} · {TYPE_LABELS[s.inspection_type] || s.inspection_type}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-5 pt-0 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ds-muted font-mono text-xs">{s.cron}</span>
                    <span className="text-ds-muted text-xs">
                      {s.enabled ? formatNextRun(s.next_run) : '-'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {s.notification_config_name && (
                      <span className="text-xs text-ds-muted mr-1">{s.notification_config_name}</span>
                    )}
                    {s.notify_email && (
                      <span className="text-xs bg-ds-surface2 text-ds-muted px-2 py-0.5 rounded-full border border-ds-border">
                        邮件
                      </span>
                    )}
                    {s.notify_wechat && (
                      <span className="text-xs bg-ds-accent/10 text-ds-accent px-2 py-0.5 rounded-full">
                        微信
                      </span>
                    )}
                    {s.notify_feishu && (
                      <span className="text-xs bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full">
                        飞书
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-3 border-t border-ds-border">
                    <Button variant="ghost" size="sm" onClick={() => handleRun(s.id)}
                      className="text-ds-muted hover:text-ds-accent h-8 px-2 flex-1"
                    >
                      <Play className="w-3.5 h-3.5 mr-1" />
                      执行
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openLogs(s.id, s.project_id)}
                      className="text-ds-muted hover:text-ds-accent h-8 px-2 flex-1"
                    >
                      <Clock className="w-3.5 h-3.5 mr-1" />
                      历史
                    </Button>
                    <Button variant="ghost" size="sm" asChild
                      className="text-ds-muted hover:text-ds-accent h-8 px-2 flex-1"
                    >
                      <Link to={`/schedules/${s.id}/edit`}>
                        <Pencil className="w-3.5 h-3.5 mr-1" />
                        编辑
                      </Link>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)}
                      className="text-ds-muted hover:text-red-500 h-8 px-2 flex-1"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      删除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* 执行历史弹窗 */}
      {logModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setLogModal(null)}>
          <div className="bg-ds-surface rounded-[18px] shadow-product max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col border border-ds-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-ds-border">
              <h3 className="font-semibold text-ds-text">执行历史</h3>
              <button onClick={() => setLogModal(null)} className="text-ds-muted hover:text-ds-text transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              {logModal.loading ? (
                <Spinner />
              ) : logModal.logs.length === 0 ? (
                <p className="text-ds-muted text-center py-8">暂无执行记录</p>
              ) : (
                <div className="space-y-3">
                  {logModal.logs.map(log => (
                    <div key={log.id} className="flex items-start gap-3 text-sm border border-ds-border rounded-xl p-4">
                      <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${log.status === 'success' ? 'bg-ds-accent' : 'bg-red-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${log.status === 'success' ? 'text-ds-accent' : 'text-red-500'}`}>
                            {log.status === 'success' ? '成功' : '失败'}
                          </span>
                          {log.report_id > 0 && (
                            <Link to={`/reports?project_id=${logModal.projectId}`} className="text-xs text-ds-accent hover:underline">
                              报告 #{log.report_id}
                            </Link>
                          )}
                        </div>
                        {log.error_message && (
                          <p className="text-red-500 text-xs mt-1">{log.error_message}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-ds-muted">
                          {log.notified_email && <span>已发邮件</span>}
                          {log.notified_wechat && <span>已发微信</span>}
                          {log.notified_feishu && <span>已发飞书</span>}
                          <span>{new Date(log.created_at).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
