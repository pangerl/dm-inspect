import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, Plus } from 'lucide-react'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'
import { Button } from '@/components/ui/button'

const CRON_PRESETS = [
  { label: '每天 10:00', value: '0 0 10 * * *' },
  { label: '每天 00:00', value: '0 0 0 * * *' },
  { label: '每周一 09:00', value: '0 0 9 * * 1' },
  { label: '每月 1 日 09:00', value: '0 0 9 1 * *' },
]

const INSPECTION_TYPES = [
  { label: '每日巡检', value: 'daily' },
  { label: '月度巡检', value: 'monthly' },
  { label: '季度巡检', value: 'quarterly' },
  { label: '年度巡检', value: 'yearly' },
]

export default function ScheduleEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = Boolean(id)

  const [projects, setProjects] = useState([])
  const [notificationConfigs, setNotificationConfigs] = useState([])
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name: '',
    project_id: '',
    cron: '',
    inspection_type: 'daily',
    enabled: true,
    notification_config_id: '',
  })

  useEffect(() => {
    Promise.all([
      api.get('/projects'),
      api.get('/notification-configs'),
    ])
      .then(([projectData, notificationData]) => {
        setProjects(projectData || [])
        setNotificationConfigs(notificationData || [])
      })
      .catch(err => toast.error(err.message))
  }, [])

  useEffect(() => {
    if (!isEdit) return
    api.get(`/schedules/${id}`)
      .then(data => {
        setForm({
          name: data.name || '',
          project_id: String(data.project_id || ''),
          cron: data.cron || '',
          inspection_type: data.inspection_type || 'daily',
          enabled: data.enabled !== false,
          notification_config_id: data.notification_config_id ? String(data.notification_config_id) : '',
        })
      })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  const updateField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name || !form.cron || !form.project_id) {
      toast.error('请填写所有必填字段')
      return
    }

    const payload = {
      ...form,
      project_id: parseInt(form.project_id, 10),
      notification_config_id: form.notification_config_id ? parseInt(form.notification_config_id, 10) : 0,
    }

    setSaving(true)
    try {
      if (isEdit) {
        await api.put(`/schedules/${id}`, payload)
      } else {
        await api.post('/schedules', payload)
      }
      toast.success(isEdit ? '任务已更新' : '任务已创建')
      navigate('/schedules')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-2xl">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-ds-muted mb-8">
        <Link to="/schedules" className="hover:text-ds-text transition-colors">定时任务</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-ds-text font-medium">{isEdit ? '编辑任务' : '新建任务'}</span>
      </div>

      <form onSubmit={handleSubmit} className="bg-ds-surface rounded-[18px] border border-ds-border overflow-hidden">
        <div className="px-6 py-6 space-y-6">
          {/* 任务名称 */}
          <div>
            <label className="block text-sm font-semibold text-ds-text mb-2">
              任务名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => updateField('name', e.target.value)}
              className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
              placeholder="例如：每日上午巡检"
              required
            />
          </div>

          {/* 关联项目 */}
          <div>
            <label className="block text-sm font-semibold text-ds-text mb-2">
              关联项目 <span className="text-red-500">*</span>
            </label>
            <select
              value={form.project_id}
              onChange={e => updateField('project_id', e.target.value)}
              className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
              required
            >
              <option value="">— 选择项目 —</option>
              {projects.map(p => (
                <option key={p.id} value={String(p.id)}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Cron 表达式 */}
          <div>
            <label className="block text-sm font-semibold text-ds-text mb-2">
              Cron 表达式 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.cron}
              onChange={e => updateField('cron', e.target.value)}
              className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
              placeholder="0 0 10 * * *"
              required
            />
            <p className="text-xs text-ds-muted mt-1.5">格式：秒 分 时 日 月 周（例如 0 0 10 * * * 表示每天 10:00）</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {CRON_PRESETS.map(preset => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => updateField('cron', preset.value)}
                  className="text-xs bg-ds-surface2 text-ds-muted px-3 py-1.5 rounded-full hover:bg-ds-accent/10 hover:text-ds-accent transition-colors border border-ds-border"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* 巡检类型 */}
          <div>
            <label className="block text-sm font-semibold text-ds-text mb-2">巡检类型</label>
            <select
              value={form.inspection_type}
              onChange={e => updateField('inspection_type', e.target.value)}
              className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
            >
              {INSPECTION_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="text-xs text-ds-muted mt-1.5">当前仅每日巡检生效，月度/季度/年度预留扩展</p>
          </div>

          {/* 启用状态 */}
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={e => updateField('enabled', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-ds-border peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ds-accent/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-ds-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-ds-accent" />
            </label>
            <span className="text-sm text-ds-muted">启用定时任务</span>
          </div>

          {/* 通知配置 */}
          <div className="bg-ds-surface2 rounded-[18px] p-5 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-ds-text">通知配置</h4>
              <Link to="/notifications" className="text-xs text-ds-accent hover:underline inline-flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                管理配置
              </Link>
            </div>

            <div>
              <label className="block text-sm font-medium text-ds-muted mb-2">选择通知配置</label>
              <select
                value={form.notification_config_id}
                onChange={e => updateField('notification_config_id', e.target.value)}
                className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
              >
                <option value="">— 不发送通知 —</option>
                {notificationConfigs.map(cfg => (
                  <option key={cfg.id} value={String(cfg.id)}>
                    {cfg.name}{cfg.enabled ? '' : '（已禁用）'}
                  </option>
                ))}
              </select>
              <p className="text-xs text-ds-muted mt-1.5">通知渠道在“通知配置”中集中维护，修改后会影响所有引用它的任务</p>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="px-6 py-4 flex items-center gap-3 bg-ds-surface2 border-t border-ds-border">
          <Button type="submit" disabled={saving}>
            {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? '保存中...' : '保存'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/schedules')}>
            取消
          </Button>
        </div>
      </form>
    </div>
  )
}
