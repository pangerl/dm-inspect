import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'

const STEPS = [
  { num: 1, label: '选择场景' },
  { num: 2, label: '填写信息' },
  { num: 3, label: '确认创建' },
]

export default function ProjectQuickCreate() {
  const toast = useToast()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  // 表单数据
  const [selectedPreset, setSelectedPreset] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [group, setGroup] = useState('')

  useEffect(() => {
    api.get('/templates/presets')
      .then(data => {
        setPresets(data || [])
        // 默认选中第一个 recommended 的预设
        const rec = data?.find(p => p.recommended)
        if (rec) setSelectedPreset(rec.key)
      })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [])

  const selectedPresetObj = presets.find(p => p.key === selectedPreset)

  const canNext = () => {
    if (step === 1) return !!selectedPreset
    if (step === 2) return projectName.trim() !== '' && group.trim() !== ''
    return true
  }

  const handleCreate = async () => {
    setCreating(true)
    try {
      const res = await api.post('/projects/quick-create', {
        preset_key: selectedPreset,
        project_name: projectName.trim(),
        group: group.trim(),
      })
      toast.success('项目已创建')
      navigate('/projects')
    } catch (err) {
      toast.error(err.message)
      setCreating(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-2xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-ds-muted mb-6">
        <Link to="/projects" className="hover:text-ds-muted">巡检项目</Link>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-ds-text font-medium">快速创建巡检项目</span>
      </div>

      {/* 步骤条 */}
      <div className="flex items-center mb-8">
        {STEPS.map((s, idx) => (
          <div key={s.num} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                step === s.num
                  ? 'bg-ds-accent text-ds-text'
                  : step > s.num
                    ? 'bg-ds-accent text-ds-text'
                    : 'bg-ds-surface2 text-ds-muted'
              }`}>
                {step > s.num ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  s.num
                )}
              </div>
              <span className={`text-xs mt-1.5 font-medium ${
                step === s.num ? 'text-ds-accent' : 'text-ds-muted'
              }`}>{s.label}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 ${step > s.num ? 'bg-ds-accent' : 'bg-ds-surface2'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: 选择场景 */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-ds-text">选择巡检场景</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {presets.map(preset => (
              <button
                key={preset.key}
                onClick={() => setSelectedPreset(preset.key)}
                className={`relative text-left p-4 rounded-xl border-2 transition-all ${
                  selectedPreset === preset.key
                    ? 'border-ds-accent bg-ds-accent/10'
                    : 'border-ds-border bg-ds-surface hover:border-ds-muted'
                }`}
              >
                {preset.recommended && (
                  <span className="absolute top-2 right-2 bg-ds-accent text-ds-text text-[10px] font-bold px-1.5 py-0.5 rounded">
                    推荐
                  </span>
                )}
                <div className="font-medium text-ds-text mb-1">{preset.name}</div>
                <div className="text-xs text-ds-muted mb-2">{preset.description}</div>
                <div className="flex flex-wrap gap-1">
                  {preset.tags?.map(tag => (
                    <span key={tag} className="text-[10px] bg-ds-surface2 text-ds-muted px-1.5 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: 填写信息 */}
      {step === 2 && (
        <div className="bg-ds-surface rounded-xl border border-ds-border p-6 space-y-5">
          <h2 className="text-lg font-semibold text-ds-text">填写基础信息</h2>
          <div>
            <label className="block text-sm font-medium text-ds-muted mb-1.5">项目名称</label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              className="w-full px-3 py-2 border border-ds-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent"
              placeholder="例如：生产环境巡检"
              required
            />
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
              这个值必须与 Nightingale 中机器的 group 标签完全一致
            </p>
          </div>
        </div>
      )}

      {/* Step 3: 确认创建 */}
      {step === 3 && (
        <div className="bg-ds-surface rounded-xl border border-ds-border p-6 space-y-5">
          <h2 className="text-lg font-semibold text-ds-text">确认创建</h2>
          <div className="space-y-3 text-sm">
            <div className="flex">
              <span className="text-ds-muted w-28">巡检场景</span>
              <span className="text-ds-text font-medium">{selectedPresetObj?.name}</span>
            </div>
            <div className="flex">
              <span className="text-ds-muted w-28">项目名称</span>
              <span className="text-ds-text font-medium">{projectName}</span>
            </div>
            <div className="flex">
              <span className="text-ds-muted w-28">Group</span>
              <span className="text-ds-text font-mono">{group}</span>
            </div>
            <div className="flex">
              <span className="text-ds-muted w-28">监控范围</span>
              <span className="text-ds-muted">
                {selectedPresetObj?.tags?.join(' / ') || '—'}
              </span>
            </div>
            <div className="flex">
              <span className="text-ds-muted w-28">默认巡检日期</span>
              <span className="text-ds-muted">生成昨日巡检报告</span>
            </div>
          </div>
        </div>
      )}

      {/* 底部按钮 */}
      <div className="flex items-center justify-between mt-8">
        <button
          onClick={() => setStep(s => Math.max(1, s - 1))}
          disabled={step === 1}
          className="text-sm font-medium text-ds-muted px-4 py-2 rounded-lg hover:bg-ds-surface2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          上一步
        </button>
        {step < 3 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!canNext()}
            className="inline-flex items-center gap-1.5 bg-ds-accent text-ds-text text-sm font-medium px-5 py-2 rounded-lg hover:bg-ds-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            下一步
          </button>
        ) : (
          <button
            onClick={handleCreate}
            disabled={creating}
            className="inline-flex items-center gap-1.5 bg-ds-accent text-ds-text text-sm font-medium px-5 py-2 rounded-lg hover:bg-ds-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {creating && <span className="w-4 h-4 border-2 border-ds-text border-t-transparent rounded-full animate-spin" />}
            {creating ? '创建中...' : '创建项目'}
          </button>
        )}
      </div>
    </div>
  )
}
