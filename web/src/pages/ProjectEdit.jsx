import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'
import { Button } from '@/components/ui/button'

export default function ProjectEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = Boolean(id)

  const [templates, setTemplates] = useState([])
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [group, setGroup] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const fetches = [api.get('/templates')]
    if (isEdit) fetches.push(api.get(`/projects/${id}`))

    Promise.all(fetches)
      .then(([tmplList, project]) => {
        const list = tmplList || []
        setTemplates(list)
        if (project) {
          setName(project.name)
          setTemplateId(String(project.template_id))
          try {
            const vars = JSON.parse(project.variables)
            setGroup(vars.group || '')
          } catch {}
        } else if (list.length > 0) {
          setTemplateId(String(list[0].id))
        }
      })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = { name, template_id: parseInt(templateId), variables: JSON.stringify({ group }) }
    try {
      if (isEdit) {
        await api.put(`/projects/${id}`, payload)
        toast.success('项目已更新')
      } else {
        await api.post('/projects', payload)
        toast.success('项目已创建')
      }
      navigate('/projects')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-lg">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-ds-muted mb-8">
        <Link to="/projects" className="hover:text-ds-text transition-colors">巡检项目</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-ds-text font-medium">{isEdit ? '编辑项目' : '创建项目'}</span>
      </div>

      <form onSubmit={handleSubmit} className="bg-ds-surface rounded-[18px] border border-ds-border overflow-hidden">
        <div className="px-6 py-6 space-y-6">
          <div>
            <label className="block text-sm font-semibold text-ds-text mb-2">项目名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
              placeholder="例如：生产环境服务器"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-ds-text mb-2">巡检模板</label>
            {templates.length === 0 ? (
              <p className="text-sm text-red-500 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                暂无模板，请先
                <Link to="/templates/new" className="underline text-ds-accent">创建模板</Link>
              </p>
            ) : (
              <select
                value={templateId}
                onChange={e => setTemplateId(e.target.value)}
                className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
                required
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-ds-text mb-2">
              巡检范围标签（group）
              <span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="text"
              value={group}
              onChange={e => setGroup(e.target.value)}
              className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
              placeholder="例如：kuvera-prod"
              required
            />
            <p className="mt-2 text-xs text-ds-muted leading-relaxed">
              这个值必须与 Nightingale 中机器的 group 标签完全一致，用于数据隔离
            </p>
          </div>
        </div>

        <div className="px-6 py-4 flex items-center gap-3 bg-ds-surface2 border-t border-ds-border">
          <Button
            type="submit"
            disabled={saving || templates.length === 0}
          >
            {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? '保存中...' : '保存'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('/projects')}
          >
            取消
          </Button>
        </div>
      </form>
    </div>
  )
}
