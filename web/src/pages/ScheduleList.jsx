import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'

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
  const [logModal, setLogModal] = useState(null) // { scheduleId, logs, loading }

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

  useEffect(() => {
    load()
  }, [])

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

  const openLogs = (id) => {
    setLogModal({ scheduleId: id, logs: [], loading: true })
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
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">定时任务</h2>
          <p className="text-sm text-gray-500 mt-1">配置自动巡检计划，支持邮件和企业微信通知</p>
        </div>
        <Link
          to="/schedules/new"
          className="inline-flex items-center gap-1.5 bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建任务
        </Link>
      </div>

      {schedules.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500">暂无定时任务</p>
          <Link to="/schedules/new" className="text-blue-600 text-sm hover:underline mt-2 inline-block">
            创建一个定时巡检任务
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">任务名称</th>
                <th className="text-left px-4 py-3 font-medium">关联项目</th>
                <th className="text-left px-4 py-3 font-medium">Cron 表达式</th>
                <th className="text-left px-4 py-3 font-medium">类型</th>
                <th className="text-left px-4 py-3 font-medium">状态</th>
                <th className="text-left px-4 py-3 font-medium">下次执行</th>
                <th className="text-left px-4 py-3 font-medium">通知</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {schedules.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-600">{getProjectName(s.project_id)}</td>
                  <td className="px-4 py-3 font-mono text-gray-600 text-xs">{s.cron}</td>
                  <td className="px-4 py-3 text-gray-600">{TYPE_LABELS[s.inspection_type] || s.inspection_type}</td>
                  <td className="px-4 py-3">
                    {s.enabled ? (
                      <span className="inline-flex items-center gap-1 text-green-700 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        启用
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-gray-500 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                        禁用
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {s.enabled ? formatNextRun(s.next_run) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {s.notify_email && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded" title={s.notify_email}>
                          邮件
                        </span>
                      )}
                      {s.notify_wechat && (
                        <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded" title="企业微信">
                          微信
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleRun(s.id)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                        title="立即执行"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => openLogs(s.id)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                        title="执行历史"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                      <Link
                        to={`/schedules/${s.id}/edit`}
                        className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                        title="编辑"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </Link>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 执行历史弹窗 */}
      {logModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setLogModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">执行历史</h3>
              <button onClick={() => setLogModal(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              {logModal.loading ? (
                <Spinner />
              ) : logModal.logs.length === 0 ? (
                <p className="text-gray-500 text-center py-8">暂无执行记录</p>
              ) : (
                <div className="space-y-3">
                  {logModal.logs.map(log => (
                    <div key={log.id} className="flex items-start gap-3 text-sm border border-gray-100 rounded-lg p-3">
                      <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${log.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${log.status === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                            {log.status === 'success' ? '成功' : '失败'}
                          </span>
                          {log.report_id > 0 && (
                            <Link to={`/reports?project_id=&date=&status=`} className="text-xs text-blue-600 hover:underline">
                              报告 #{log.report_id}
                            </Link>
                          )}
                        </div>
                        {log.error_message && (
                          <p className="text-red-600 text-xs mt-1">{log.error_message}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          {log.notified_email && <span>已发邮件</span>}
                          {log.notified_wechat && <span>已发微信</span>}
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
