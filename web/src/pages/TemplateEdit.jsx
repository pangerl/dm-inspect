import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'

// ── YAML <-> 基础模式配置 转换工具 ────────────────────────────

function parseBasicFromYAML(yaml) {
  const config = {
    diskPaths: [],
    middlewares: { mysql: false, redis: false, nacos: false },
    container: /container_query:/.test(yaml),
    containerServices: /container_services_query:/.test(yaml),
    containerPorts: /container_ports_query:/.test(yaml),
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
    config.diskPaths = ['/', '/data']
    config.container = true
  }

  return config
}

function generateYAMLFromBasic(config) {
  let yaml = '# 磁盘使用率\nresources:\n'

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
  if (config.containerServices) {
    yaml += "container_services_query: \"docker_container_status_started_at{group='{{.group}}'}\"\n"
  }
  if (config.containerPorts) {
    yaml += "container_ports_query: \"net_response_result_code{group='{{.group}}'}\"\n"
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
    diskPaths: ['/', '/data'],
    middlewares: { mysql: false, redis: false, nacos: false },
    container: true,
    containerServices: true,
    containerPorts: true,
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
      <div className="flex items-center gap-2 text-sm text-ds-muted mb-6">
        <Link to="/templates" className="hover:text-ds-muted">模板管理</Link>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-ds-text font-medium">{isEdit ? '编辑模板' : '创建模板'}</span>
      </div>

      <form onSubmit={handleSubmit} className="bg-ds-surface rounded-xl border border-ds-border divide-y divide-ds-border">

        {/* 预设选择器 */}
        {presets.length > 0 && (
          <div className="px-6 py-4 bg-ds-accent/10 rounded-t-xl">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-ds-accent mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-ds-text mb-1">从预设模板开始</p>
                <p className="text-xs text-ds-accent mb-2.5">选择适合场景的预设，内容会自动填入，可在此基础上修改</p>
                <select
                  value={selectedPreset}
                  onChange={e => handlePresetChange(e.target.value)}
                  className="w-full px-3 py-2 border border-ds-accent rounded-lg text-sm bg-ds-surface focus:outline-none focus:ring-2 focus:ring-ds-accent"
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
          <label className="block text-sm font-medium text-ds-muted mb-1.5">模板名称</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 border border-ds-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent"
            placeholder="例如：标准 Linux 服务器"
            required
          />
        </div>

        {/* 模式切换 */}
        <div className="px-6 py-4 bg-ds-surface2">
          <div className="flex items-center justify-between">
            <div className="flex items-center bg-ds-surface rounded-lg border border-ds-border p-0.5">
              <button
                type="button"
                onClick={() => handleModeChange('basic')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  mode === 'basic'
                    ? 'bg-ds-accent text-ds-text'
                    : 'text-ds-muted hover:text-ds-text'
                }`}
              >
                基础模式
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('advanced')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  mode === 'advanced'
                    ? 'bg-ds-accent text-ds-text'
                    : 'text-ds-muted hover:text-ds-text'
                }`}
              >
                高级模式 YAML
              </button>
            </div>
            <p className="text-xs text-ds-muted">
              {mode === 'basic'
                ? '通过表单配置巡检项，系统自动生成 YAML'
                : '直接编辑 YAML，适合熟悉 PromQL 的用户'}
            </p>
          </div>
        </div>

        {/* 基础模式内容 */}
        {mode === 'basic' && (
          <div className="px-6 py-5 space-y-6">
            {/* 磁盘路径 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-ds-text">磁盘路径</h4>
                <button
                  type="button"
                  onClick={addDiskPath}
                  className="text-xs text-ds-accent hover:text-ds-accent font-medium"
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
                      className="flex-1 px-3 py-2 border border-ds-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent"
                      placeholder="例如：/data"
                    />
                    <button
                      type="button"
                      onClick={() => removeDiskPath(idx)}
                      className="p-2 rounded text-ds-muted hover:text-red-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-400"
                      title="删除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {basicConfig.diskPaths.length === 0 && (
                  <p className="text-sm text-ds-muted">未配置磁盘监控</p>
                )}
              </div>
            </div>

            {/* 中间件监控 */}
            <div>
              <h4 className="text-sm font-semibold text-ds-text mb-3">中间件监控</h4>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={basicConfig.middlewares.mysql}
                    onChange={e => updateBasicConfig(prev => ({
                      ...prev,
                      middlewares: { ...prev.middlewares, mysql: e.target.checked }
                    }))}
                    className="w-4 h-4 text-ds-accent rounded border-ds-border focus:ring-ds-accent"
                  />
                  <span className="text-sm text-ds-muted">MySQL</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={basicConfig.middlewares.redis}
                    onChange={e => updateBasicConfig(prev => ({
                      ...prev,
                      middlewares: { ...prev.middlewares, redis: e.target.checked }
                    }))}
                    className="w-4 h-4 text-ds-accent rounded border-ds-border focus:ring-ds-accent"
                  />
                  <span className="text-sm text-ds-muted">Redis</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={basicConfig.middlewares.nacos}
                    onChange={e => updateBasicConfig(prev => ({
                      ...prev,
                      middlewares: { ...prev.middlewares, nacos: e.target.checked }
                    }))}
                    className="w-4 h-4 text-ds-accent rounded border-ds-border focus:ring-ds-accent"
                  />
                  <span className="text-sm text-ds-muted">Nacos</span>
                </label>
              </div>
            </div>

            {/* 容器统计 */}
            <div>
              <h4 className="text-sm font-semibold text-ds-text mb-3">容器统计</h4>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={basicConfig.container}
                    onChange={e => updateBasicConfig({ container: e.target.checked })}
                    className="w-4 h-4 text-ds-accent rounded border-ds-border focus:ring-ds-accent"
                  />
                  <span className="text-sm text-ds-muted">统计运行中的容器数量</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={basicConfig.containerServices}
                    onChange={e => updateBasicConfig({ containerServices: e.target.checked })}
                    className="w-4 h-4 text-ds-accent rounded border-ds-border focus:ring-ds-accent"
                  />
                  <span className="text-sm text-ds-muted">采集容器服务详情（名称、镜像、状态）</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={basicConfig.containerPorts}
                    onChange={e => updateBasicConfig({ containerPorts: e.target.checked })}
                    className="w-4 h-4 text-ds-accent rounded border-ds-border focus:ring-ds-accent"
                  />
                  <span className="text-sm text-ds-muted">采集容器端口连通状态</span>
                </label>
              </div>
            </div>

            {/* YAML 预览 */}
            <div className="bg-ds-surface2 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-ds-muted">自动生成的 YAML</span>
              </div>
              <pre className="text-xs font-mono text-ds-muted overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{content}</pre>
            </div>
          </div>
        )}

        {/* 高级模式内容 */}
        {mode === 'advanced' && (
          <div className="px-6 py-5">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-ds-muted">YAML 配置</label>
              <span className="text-xs text-ds-muted">
                使用 <code className="bg-ds-surface2 px-1 py-0.5 rounded font-mono">{'{{.group}}'}</code> 作为变量占位符
              </span>
            </div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full px-3 py-2.5 border border-ds-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent resize-none"
              rows={22}
              spellCheck={false}
              placeholder={`# 从上方选择预设，或手动填写 YAML 配置\n# 支持以下顶级字段：\n#   resources:                   磁盘使用率查询\n#   middlewares:                 中间件监控\n#   container_query:             容器运行数量统计\n#   container_services_query:    容器服务详情（名称、镜像、状态、启动时间）\n#   container_ports_query:       容器端口连通状态`}
              required
            />
          </div>
        )}

        {/* 操作按钮 */}
        <div className="px-6 py-4 flex items-center gap-3 bg-ds-surface2 rounded-b-xl">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-ds-accent text-ds-text text-sm font-medium px-4 py-2 rounded-lg hover:bg-ds-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving && <span className="w-4 h-4 border-2 border-ds-text border-t-transparent rounded-full animate-spin" />}
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/templates')}
            className="text-sm font-medium text-ds-muted px-4 py-2 rounded-lg hover:bg-ds-surface2 transition-colors"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  )
}
