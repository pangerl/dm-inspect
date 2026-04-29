import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, ChevronRight, Zap } from 'lucide-react'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'
import { Button } from '@/components/ui/button'

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

  const [selectedPreset, setSelectedPreset] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [group, setGroup] = useState('')

  useEffect(() => {
    api.get('/templates/presets')
      .then(data => {
        setPresets(data || [])
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
      await api.post('/projects/quick-create', {
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
      <div className="flex items-center gap-2 text-sm text-ds-muted mb-8">
        <Link to="/projects" className="hover:text-ds-text transition-colors">巡检项目</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-ds-text font-medium">快速创建巡检项目</span>
      </div>

      {/* 步骤条 */}
      <div className="flex items-center mb-10">
        {STEPS.map((s, idx) => (
          <div key={s.num} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                step === s.num
                  ? 'bg-ds-accent text-white'
                  : step > s.num
                    ? 'bg-ds-accent text-white'
                    : 'bg-ds-surface2 text-ds-muted border border-ds-border'
              }`}>
                {step > s.num ? (
                  <Check className="w-4 h-4" />
                ) : (
                  s.num
                )}
              </div>
              <span className={`text-xs mt-2 font-medium ${
                step === s.num ? 'text-ds-accent' : 'text-ds-muted'
              }`}>{s.label}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-3 ${step > s.num ? 'bg-ds-accent' : 'bg-ds-border'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: 选择场景 */}
      {step === 1 && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-ds-text tracking-tight-apple">选择巡检场景</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {presets.map(preset => (
              <button
                key={preset.key}
                onClick={() => setSelectedPreset(preset.key)}
                className={`relative text-left p-5 rounded-[18px] border-2 transition-all ${
                  selectedPreset === preset.key
                    ? 'border-ds-accent bg-ds-accent/5'
                    : 'border-ds-border bg-ds-surface hover:border-ds-muted'
                }`}
              >
                {preset.recommended && (
                  <span className="absolute top-3 right-3 bg-ds-accent text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    推荐
                  </span>
                )}
                <div className="font-semibold text-ds-text mb-1.5">{preset.name}</div>
                <div className="text-xs text-ds-muted mb-3 leading-relaxed">{preset.description}</div>
                <div className="flex flex-wrap gap-1.5">
                  {preset.tags?.map(tag => (
                    <span key={tag} className="text-[10px] bg-ds-surface2 text-ds-muted px-2 py-0.5 rounded-full">
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
        <div className="bg-ds-surface rounded-[18px] border border-ds-border p-6 space-y-6">
          <h2 className="text-xl font-semibold text-ds-text tracking-tight-apple">填写基础信息</h2>
          <div>
            <label className="block text-sm font-semibold text-ds-text mb-2">项目名称</label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              className="w-full px-4 py-2.5 border border-ds-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ds-accent focus:border-transparent transition-all"
              placeholder="例如：生产环境巡检"
              required
            />
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
              这个值必须与 Nightingale 中机器的 group 标签完全一致
            </p>
          </div>
        </div>
      )}

      {/* Step 3: 确认创建 */}
      {step === 3 && (
        <div className="bg-ds-surface rounded-[18px] border border-ds-border p-6 space-y-5">
          <h2 className="text-xl font-semibold text-ds-text tracking-tight-apple">确认创建</h2>
          <div className="space-y-3 text-sm">
            <div className="flex">
              <span className="text-ds-muted w-28 shrink-0">巡检场景</span>
              <span className="text-ds-text font-medium">{selectedPresetObj?.name}</span>
            </div>
            <div className="flex">
              <span className="text-ds-muted w-28 shrink-0">项目名称</span>
              <span className="text-ds-text font-medium">{projectName}</span>
            </div>
            <div className="flex">
              <span className="text-ds-muted w-28 shrink-0">Group</span>
              <span className="text-ds-text font-mono">{group}</span>
            </div>
            <div className="flex">
              <span className="text-ds-muted w-28 shrink-0">监控范围</span>
              <span className="text-ds-muted">
                {selectedPresetObj?.tags?.join(' / ') || '—'}
              </span>
            </div>
            <div className="flex">
              <span className="text-ds-muted w-28 shrink-0">默认巡检日期</span>
              <span className="text-ds-muted">生成昨日巡检报告</span>
            </div>
          </div>
        </div>
      )}

      {/* 底部按钮 */}
      <div className="flex items-center justify-between mt-10">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep(s => Math.max(1, s - 1))}
          disabled={step === 1}
        >
          上一步
        </Button>
        {step < 3 ? (
          <Button
            onClick={() => setStep(s => s + 1)}
            disabled={!canNext()}
          >
            下一步
          </Button>
        ) : (
          <Button
            onClick={handleCreate}
            disabled={creating}
          >
            {creating && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {creating ? '创建中...' : '创建项目'}
          </Button>
        )}
      </div>
    </div>
  )
}
