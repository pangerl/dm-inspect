import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'

// ── YAML <-> 基础模式配置 转换工具 ────────────────────────────

function parseBasicFromYAML(yaml) {
  const config = {
    cpu: /cpu_query:/.test(yaml),
    mem: /mem_query:/.test(yaml),
    diskPaths: [],
    middlewares: { mysql: false, redis: false, nacos: false },
    container: /container_query:/.test(yaml),
  }

  // 解析磁盘路径
  const diskSection = yaml.match(/disk_queries:([\s\S]*?)(?=\n\w|^\w)/)
  if (diskSection) {
    const pathMatches = diskSection[1].match(/path:\s*["']?([^"'\n]+)["']?/g)
    if (pathMatches) {
      config.diskPaths = pathMatches.map(m => {
        const match = m.match(/path:\s*["']?([^"'\n]+)["']?/)
        return match ? match[1] : ''
      }).filter(Boolean)
    }
  }

  // 解析中间件类型
  if (/type:\s*mysql/.test(yaml)) config.middlewares.mysql = true
  if (/type:\s*redis/.test(yaml)) config.middlewares.redis = true
  if (/type:\s*nacos/.test(yaml)) config.middlewares.nacos = true

  // 若没有任何内容，给一套默认配置
  if (!yaml.trim()) {
    config.cpu = true
    config.mem = true
    config.diskPaths = ['/', '/data']
    config.container = true
  }

  return config
}

function generateYAMLFromBasic(config) {
  let yaml = '# 资源使用率\nresources:\n'

  if (config.cpu) {
    yaml += "  cpu_query: \"avg by(ident) (cpu_usage_active{cpu='cpu-total',group='{{.group}}'})\"\n"
  }
  if (config.mem) {
    yaml += "  mem_query: \"avg by(ident) (mem_used_percent{group='{{.group}}'})\"\n"
  }

  if (config.diskPaths.length > 0) {
    yaml += '  disk_queries:\n'
    config.diskPaths.forEach(path => {
      const safePath = path.replace(/'/g, "\\'")
      yaml += `    - path: "${safePath}"\n`
      yaml += `      query: "avg by(ident) (disk_used_percent{path='${safePath}',group='{{.group}}'})"\n`
    })
  }

  const activeMW = Object.entries(config.middlewares).filter(([_, v]) => v).map(([k]) => k)
  if (activeMW.length > 0) {
    yaml += '\n# 中间件监控\nmiddlewares:\n'
    activeMW.forEach(type => {
      if (type === 'mysql') {
        yaml += "  - type: mysql\n"
        yaml += "    query: \"mysql_up{group='{{.group}}'}\"\n"
        yaml += "    online_value: 1\n"
        yaml += "    extra_metrics:\n"
        yaml += "      - name: \"连接数\"\n"
        yaml += "        query: \"mysql_global_status_threads_connected{group='{{.group}}'}\"\n"
        yaml += "      - name: \"QPS\"\n"
        yaml += "        query: \"rate(mysql_global_status_queries{group='{{.group}}'}[5m])\"\n"
      } else if (type === 'redis') {
        yaml += "  - type: redis\n"
        yaml += "    query: \"redis_up{group='{{.group}}'}\"\n"
        yaml += "    online_value: 1\n"
        yaml += "    extra_metrics:\n"
        yaml += "      - name: \"连接数\"\n"
        yaml += "        query: \"redis_connected_clients{group='{{.group}}'}\"\n"
        yaml += "      - name: \"命中率\"\n"
        yaml += "        query: \"redis_keyspace_hitrate{group='{{.group}}'}\"\n"
      } else if (type === 'nacos') {
        yaml += "  - type: nacos\n"
        yaml += "    query: \"net_response_result_code{service='nacos',group='{{.group}}'}\"\n"
        yaml += "    online_value: 0\n"
      }
    })
  }

  if (config.container) {
    yaml += "\n# 容器运行情况\n"
    yaml += "container_query: \"count by(ident) (docker_container_status_started_at{container_status='running',group='{{.group}}'})\"\n"
  }

  return yaml.trim()
}

// ── 组件 ──────────────────────────────────────────────────────

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

  // 双模式
  const [mode, setMode] = useState('basic') // 'basic' | 'advanced'

  // 基础模式配置
  const [basicConfig, setBasicConfig] = useState({
    cpu: true,
    mem: true,
    diskPaths: ['/', '/data'],
    middlewares: { mysql: false, redis: false, nacos: false },
    container: true,
  })

  // 加载预设列表
  useEffect(() => {
    api.get('/templates/presets')
      .then(data => setPresets(data || []))
      .catch(() => {})
  }, [])

  // 编辑时加载现有内容
  useEffect(() => {
    if (!isEdit) return
    api.get(`/templates/${id}`)
      .then(data => {
        setName(data.name)
        setContent(data.content)
        setBasicConfig(parseBasicFromYAML(data.content))
      })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  // 基础模式变更时同步更新 YAML content
  const updateBasicConfig = (updater) => {
    setBasicConfig(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater }
      // 同步生成 YAML
      setContent(generateYAMLFromBasic(next))
      return next
    })
  }

  // 选择预设后填充内容
  const handlePresetChange = (key) => {
    setSelectedPreset(key)
    if (!key) return
    const preset = presets.find(p => p.key === key)
    if (!preset) return
    const parsed = parseBasicFromYAML(preset.content)
    setBasicConfig(parsed)
    setContent(preset.content)
    if (!isEdit && !name) {
      setName(preset.name)
    }
  }

  // 切换模式
  const handleModeChange = (newMode) => {
    if (newMode === 'basic') {
      // 从 YAML 切回基础模式，尝试解析
      setBasicConfig(parseBasicFromYAML(content))
    }
    setMode(newMode)
  }

  // 磁盘路径操作
  const addDiskPath = () => {
    updateBasicConfig(prev => ({
      ...prev,
      diskPaths: [...prev.diskPaths, ''],
    }))
  }

  const updateDiskPath = (idx, val) => {
    updateBasicConfig(prev => {
      const paths = [...prev.diskPaths]
      paths[idx] = val
      return { ...prev, diskPaths: paths }
    })
  }

  const removeDiskPath = (idx) => {
    updateBasicConfig(prev => ({
      ...prev,
      diskPaths: prev.diskPaths.filter((_, i) => i !== idx),
    }))
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

        {/* 模式切换 */}
        <div className="px-6 py-4 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center bg-white rounded-lg border border-gray-200 p-0.5">
              <button
                type="button"
                onClick={() => handleModeChange('basic')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  mode === 'basic'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                基础模式
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('advanced')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  mode === 'advanced'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                高级模式 YAML
              </button>
            </div>
            <p className="text-xs text-gray-500">
              {mode === 'basic'
                ? '通过表单配置巡检项，系统自动生成 YAML'
                : '直接编辑 YAML，适合熟悉 PromQL 的用户'}
            </p>
          </div>
        </div>

        {/* 基础模式内容 */}
        {mode === 'basic' && (
          <div className="px-6 py-5 space-y-6">
            {/* 资源监控 */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">资源监控</h4>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={basicConfig.cpu}
                    onChange={e => updateBasicConfig({ cpu: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">CPU</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={basicConfig.mem}
                    onChange={e => updateBasicConfig({ mem: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">内存</span>
                </label>
              </div>
            </div>

            {/* 磁盘路径 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-900">磁盘路径</h4>
                <button
                  type="button"
                  onClick={addDiskPath}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  + 添加路径
                </button>
              </div>
              <div className="space-y-2">
                {basicConfig.diskPaths.map((path, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={path}
                      onChange={e => updateDiskPath(idx, e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="例如：/data"
                    />
                    <button
                      type="button"
                      onClick={() => removeDiskPath(idx)}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                      title="删除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {basicConfig.diskPaths.length === 0 && (
                  <p className="text-sm text-gray-400">未配置磁盘监控</p>
                )}
              </div>
            </div>

            {/* 中间件监控 */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">中间件监控</h4>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={basicConfig.middlewares.mysql}
                    onChange={e => updateBasicConfig(prev => ({
                      ...prev,
                      middlewares: { ...prev.middlewares, mysql: e.target.checked }
                    }))}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">MySQL</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={basicConfig.middlewares.redis}
                    onChange={e => updateBasicConfig(prev => ({
                      ...prev,
                      middlewares: { ...prev.middlewares, redis: e.target.checked }
                    }))}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Redis</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={basicConfig.middlewares.nacos}
                    onChange={e => updateBasicConfig(prev => ({
                      ...prev,
                      middlewares: { ...prev.middlewares, nacos: e.target.checked }
                    }))}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Nacos</span>
                </label>
              </div>
            </div>

            {/* 容器统计 */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">容器统计</h4>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={basicConfig.container}
                  onChange={e => updateBasicConfig({ container: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">统计运行中的容器数量</span>
              </label>
            </div>

            {/* YAML 预览 */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500">自动生成的 YAML</span>
              </div>
              <pre className="text-xs font-mono text-gray-600 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{content}</pre>
            </div>
          </div>
        )}

        {/* 高级模式内容 */}
        {mode === 'advanced' && (
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
        )}

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
