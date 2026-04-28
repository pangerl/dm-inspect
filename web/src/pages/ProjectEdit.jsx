import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'

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
      <div className="flex items-center gap-2 text-sm text-ds-muted mb-6">
        <Link to="/projects" className="hover:text-ds-muted">巡检项目</Link>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-ds-text font-medium">{isEdit ? '编辑项目' : '创建项目'}</span>
      </div>

      <form onSubmit={handleSubmit} className="bg-ds-surface rounded-xl border border-ds-border divide-y divide-ds-border">
        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-ds-muted mb-1.5">项目名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-ds-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent"
              placeholder="例如：生产环境服务器"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ds-muted mb-1.5">巡检模板</label>
            {templates.length === 0 ? (
              <p className="text-sm text-amber-400 flex items-center gap-1.5">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                暂无模板，请先
                <Link to="/templates/new" className="underline text-ds-accent">创建模板</Link>
              </p>
            ) : (
              <select
                value={templateId}
                onChange={e => setTemplateId(e.target.value)}
                className="w-full px-3 py-2 border border-ds-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent"
                required
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-ds-muted mb-1.5">
              巡检范围标签（group）
              <span className="text-red-400 ml-0.5">*</span>
            </label>
            <input
              type="text"
              value={group}
              onChange={e => setGroup(e.target.value)}
              className="w-full px-3 py-2 border border-ds-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent"
              placeholder="例如：kuvera-prod"
              required
            />
            <p className="mt-1.5 text-xs text-ds-muted">
              这个值必须与 Nightingale 中机器的 group 标签完全一致，用于数据隔离
            </p>
          </div>
        </div>

        <div className="px-6 py-4 flex items-center gap-3 bg-ds-surface2 rounded-b-xl">
          <button
            type="submit"
            disabled={saving || templates.length === 0}
            className="inline-flex items-center gap-1.5 bg-ds-accent text-ds-text text-sm font-medium px-4 py-2 rounded-lg hover:bg-ds-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving && <span className="w-4 h-4 border-2 border-ds-text border-t-transparent rounded-full animate-spin" />}
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="text-sm font-medium text-ds-muted px-4 py-2 rounded-lg hover:bg-ds-surface2 transition-colors"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  )
}
