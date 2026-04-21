import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'

export default function TemplateEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = Boolean(id)

  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [presets, setPresets] = useState([])
  const [selectedPreset, setSelectedPreset] = useState('')

  // 加载预设列表
  useEffect(() => {
    api.get('/templates/presets')
      .then(data => setPresets(data || []))
      .catch(() => {}) // 预设加载失败不影响主流程
  }, [])

  // 编辑时加载现有内容
  useEffect(() => {
    if (!isEdit) return
    api.get(`/templates/${id}`)
      .then(data => {
        setName(data.name)
        setContent(data.content)
      })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  // 选择预设后填充内容
  const handlePresetChange = (key) => {
    setSelectedPreset(key)
    if (!key) return
    const preset = presets.find(p => p.key === key)
    if (!preset) return
    setContent(preset.content)
    // 新建时自动填充名称（若用户尚未输入）
    if (!isEdit && !name) {
      setName(preset.name)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (isEdit) {
        await api.put(`/templates/${id}`, { name, content })
      } else {
        await api.post('/templates', { name, content })
      }
      toast.success(isEdit ? '模板已更新' : '模板已创建')
      navigate('/templates')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-3xl">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link to="/templates" className="hover:text-gray-700">模板管理</Link>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-900 font-medium">{isEdit ? '编辑模板' : '创建模板'}</span>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">

        {/* 预设选择器 */}
        {presets.length > 0 && (
          <div className="px-6 py-4 bg-blue-50 rounded-t-xl">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-800 mb-1">从预设模板开始</p>
                <p className="text-xs text-blue-600 mb-2.5">选择适合场景的预设，内容会自动填入，可在此基础上修改</p>
                <select
                  value={selectedPreset}
                  onChange={e => handlePresetChange(e.target.value)}
                  className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">— 选择预设模板 —</option>
                  {presets.map(p => (
                    <option key={p.key} value={p.key}>{p.name}　{p.description}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* 模板名称 */}
        <div className="px-6 py-5">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">模板名称</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="例如：标准 Linux 服务器"
            required
          />
        </div>

        {/* YAML 内容 */}
        <div className="px-6 py-5">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-700">YAML 配置</label>
            <span className="text-xs text-gray-400">
              使用 <code className="bg-gray-100 px-1 py-0.5 rounded font-mono">{'{{.group}}'}</code> 作为变量占位符
            </span>
          </div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={22}
            spellCheck={false}
            placeholder={`# 从上方选择预设，或手动填写 YAML 配置\n# 支持以下顶级字段：\n#   resources:      资源使用率查询\n#   middlewares:    中间件监控\n#   container_query: 容器统计`}
            required
          />
        </div>

        {/* 操作按钮 */}
        <div className="px-6 py-4 flex items-center gap-3 bg-gray-50 rounded-b-xl">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/templates')}
            className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  )
}
