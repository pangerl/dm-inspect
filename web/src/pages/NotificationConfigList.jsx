import { useEffect, useState } from 'react'
import { Mail, MessageSquare, Pencil, Plus, Send, Trash2, X } from 'lucide-react'
import { api } from '../api'
import EmptyState from '../components/EmptyState'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const EMPTY_FORM = {
  id: null,
  name: '',
  notify_email: '',
  notify_wechat: '',
  notify_feishu: '',
  enabled: true,
}

export default function NotificationConfigList() {
  const toast = useToast()
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const load = () => {
    setLoading(true)
    api.get('/notification-configs')
      .then(data => setConfigs(data || []))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const updateField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setConfirmId(null)
  }

  const editConfig = (cfg) => {
    setForm({
      id: cfg.id,
      name: cfg.name || '',
      notify_email: cfg.notify_email || '',
      notify_wechat: cfg.notify_wechat || '',
      notify_feishu: cfg.notify_feishu || '',
      enabled: cfg.enabled !== false,
    })
    setConfirmId(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('请填写配置名称')
      return
    }
    if (!form.notify_email.trim() && !form.notify_wechat.trim() && !form.notify_feishu.trim()) {
      toast.error('至少填写一种通知渠道')
      return
    }

    const payload = {
      name: form.name.trim(),
      notify_email: form.notify_email.trim(),
      notify_wechat: form.notify_wechat.trim(),
      notify_feishu: form.notify_feishu.trim(),
      enabled: form.enabled,
    }

    setSaving(true)
    try {
      if (form.id) {
        await api.put(`/notification-configs/${form.id}`, payload)
        toast.success('通知配置已更新')
      } else {
        await api.post('/notification-configs', payload)
        toast.success('通知配置已创建')
      }
      resetForm()
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await api.del(`/notification-configs/${id}`)
      toast.success('通知配置已删除')
      if (form.id === id) resetForm()
      load()
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
          <h1 className="text-2xl font-semibold text-ds-text tracking-tight-apple">通知配置</h1>
          <p className="text-sm text-ds-muted mt-1 leading-relaxed">复用通知渠道，定时任务只需选择一份配置</p>
        </div>
        <Button type="button" onClick={resetForm} className="inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          新建配置
        </Button>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div>
          {configs.length === 0 ? (
            <EmptyState
              title="暂无通知配置"
              description="先创建一份通知配置，再在定时任务中复用"
              action={
                <Button type="button" onClick={resetForm}>
                  创建通知配置
                </Button>
              }
            />
          ) : (
            <div className="hidden md:block bg-ds-surface rounded-[18px] border border-ds-border overflow-hidden">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-ds-border bg-ds-surface2">
                    <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">配置名称</th>
                    <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">渠道</th>
                    <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">状态</th>
                    <th className="text-left px-5 py-3.5 text-xs font-semibold text-ds-muted uppercase tracking-wider">创建时间</th>
                    <th className="px-5 py-3.5 w-36" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ds-border">
                  {configs.map(cfg => (
                    <tr key={cfg.id} className="hover:bg-ds-surface2 transition-colors">
                      <td className="px-5 py-4 font-medium text-ds-text">{cfg.name}</td>
                      <td className="px-5 py-4">
                        <ChannelBadges cfg={cfg} />
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge enabled={cfg.enabled} />
                      </td>
                      <td className="px-5 py-4 text-ds-muted">
                        {new Date(cfg.created_at).toLocaleString('zh-CN')}
                      </td>
                      <td className="px-5 py-4">
                        <RowActions
                          cfg={cfg}
                          confirmId={confirmId}
                          onEdit={editConfig}
                          onDelete={handleDelete}
                          onConfirm={setConfirmId}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {configs.length > 0 && (
            <div className="md:hidden space-y-3">
              {configs.map(cfg => (
                <Card key={cfg.id} className="bg-ds-surface border-ds-border rounded-[18px]">
                  <CardHeader className="p-5 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base text-ds-text font-medium">{cfg.name}</CardTitle>
                        <CardDescription className="text-xs text-ds-muted mt-1">
                          {new Date(cfg.created_at).toLocaleString('zh-CN')}
                        </CardDescription>
                      </div>
                      <StatusBadge enabled={cfg.enabled} />
                    </div>
                  </CardHeader>
                  <CardContent className="p-5 pt-0 space-y-4">
                    <ChannelBadges cfg={cfg} />
                    <RowActions
                      cfg={cfg}
                      confirmId={confirmId}
                      onEdit={editConfig}
                      onDelete={handleDelete}
                      onConfirm={setConfirmId}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="bg-ds-surface rounded-[18px] border border-ds-border overflow-hidden">
          <div className="px-5 py-4 border-b border-ds-border flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-ds-text">{form.id ? '编辑配置' : '新建配置'}</h2>
              <p className="text-xs text-ds-muted mt-1">保存后可被多个定时任务复用</p>
            </div>
            {form.id && (
              <button type="button" onClick={resetForm} className="text-ds-muted hover:text-ds-text transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="p-5 space-y-5">
            <div>
              <label className="block text-sm font-semibold text-ds-text mb-2">
                配置名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => updateField('name', e.target.value)}
                className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
                placeholder="例如：运维日报通知"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-ds-text mb-2">邮件收件人</label>
              <input
                type="text"
                value={form.notify_email}
                onChange={e => updateField('notify_email', e.target.value)}
                className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
                placeholder="ops@example.com, admin@example.com"
              />
              <p className="text-xs text-ds-muted mt-1.5">多个邮箱用逗号分隔，需配置 SMTP 环境变量</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-ds-text mb-2">企业微信 Webhook</label>
              <input
                type="text"
                value={form.notify_wechat}
                onChange={e => updateField('notify_wechat', e.target.value)}
                className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
                placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-ds-text mb-2">飞书 Webhook</label>
              <input
                type="text"
                value={form.notify_feishu}
                onChange={e => updateField('notify_feishu', e.target.value)}
                className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
                placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
              />
            </div>

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
              <span className="text-sm text-ds-muted">启用通知配置</span>
            </div>
          </div>

          <div className="px-5 py-4 flex items-center gap-3 bg-ds-surface2 border-t border-ds-border">
            <Button type="submit" disabled={saving}>
              {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? '保存中...' : '保存'}
            </Button>
            <Button type="button" variant="ghost" onClick={resetForm}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ChannelBadges({ cfg }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {cfg.notify_email && (
        <span className="inline-flex items-center gap-1 text-xs bg-ds-surface2 text-ds-muted px-2 py-0.5 rounded-full border border-ds-border" title={cfg.notify_email}>
          <Mail className="w-3 h-3" />
          邮件
        </span>
      )}
      {cfg.notify_wechat && (
        <span className="inline-flex items-center gap-1 text-xs bg-ds-accent/10 text-ds-accent px-2 py-0.5 rounded-full" title="企业微信">
          <MessageSquare className="w-3 h-3" />
          微信
        </span>
      )}
      {cfg.notify_feishu && (
        <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full" title="飞书">
          <Send className="w-3 h-3" />
          飞书
        </span>
      )}
      {!cfg.notify_email && !cfg.notify_wechat && !cfg.notify_feishu && (
        <span className="text-xs text-ds-muted">未配置渠道</span>
      )}
    </div>
  )
}

function StatusBadge({ enabled }) {
  return enabled ? (
    <span className="inline-flex items-center gap-1.5 text-ds-accent text-xs font-medium">
      <span className="w-2 h-2 rounded-full bg-ds-accent" />
      启用
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-ds-muted text-xs">
      <span className="w-2 h-2 rounded-full bg-ds-border" />
      禁用
    </span>
  )
}

function RowActions({ cfg, confirmId, onEdit, onDelete, onConfirm }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onEdit(cfg)}
        className="text-ds-accent hover:text-ds-accent hover:bg-ds-accent/10 h-8 px-2"
      >
        <Pencil className="w-3.5 h-3.5 mr-1" />
        编辑
      </Button>
      {confirmId === cfg.id ? (
        <>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDelete(cfg.id)}
            className="h-8 px-2 text-xs"
          >
            确认
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onConfirm(null)}
            className="h-8 px-2 text-xs"
          >
            取消
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onConfirm(cfg.id)}
          className="text-red-500 hover:text-red-600 hover:bg-red-500/10 h-8 px-2"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" />
          删除
        </Button>
      )}
    </div>
  )
}
