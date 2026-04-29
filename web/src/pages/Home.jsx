import { Link } from 'react-router-dom'
import {
  Server,
  HardDrive,
  Database,
  Container,
  Bell,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Zap,
  BarChart3,
  FileText,
  Settings2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

const FEATURES = [
  {
    icon: Server,
    title: '服务器概览',
    desc: '通过 N9E Targets API 获取在线状态、磁盘使用率、时间偏移，自动标注异常。',
  },
  {
    icon: HardDrive,
    title: '资源监控',
    desc: '按机器展示系统盘 / 与数据盘 /data 磁盘使用率，支持自定义监控路径。',
  },
  {
    icon: Database,
    title: '中间件监控',
    desc: 'MySQL、Redis、Nacos 在线状态及关键指标（连接数、QPS、命中率等）。',
  },
  {
    icon: Container,
    title: '容器监控',
    desc: '运行中容器数汇总，展示服务详情（名称、镜像、状态）与端口连通状态。',
  },
  {
    icon: Bell,
    title: '告警聚合',
    desc: '对接 N9E，按 group 标签过滤，按 S1/S2/S3 分级展示告警事件。',
  },
  {
    icon: Clock,
    title: '定时巡检',
    desc: '基于 Cron 表达式自动执行，支持邮件（HTML 报告）和企业微信机器人通知。',
  },
]

const STEPS = [
  {
    num: '01',
    title: '选择场景',
    desc: '从 3 种预设模板中选择匹配的巡检场景',
    icon: Settings2,
  },
  {
    num: '02',
    title: '填写标签',
    desc: '输入项目名称和 Nightingale group 标签',
    icon: FileText,
  },
  {
    num: '03',
    title: '执行巡检',
    desc: '系统自动并发执行 4 大区块巡检任务',
    icon: Zap,
  },
  {
    num: '04',
    title: '查看报告',
    desc: '生成结构化 Markdown 报告，支持复制和导出',
    icon: BarChart3,
  },
]

const NOTES = [
  {
    icon: AlertTriangle,
    title: 'PromQL 分组语法',
    desc: '必须使用 by(ident) 分组，N9E Categraf agent 使用 ident 标签而非 instance。',
  },
  {
    icon: ShieldCheck,
    title: 'group 标签一致性',
    desc: 'group 值必须与 Nightingale 中机器的自定义标签完全一致，否则无法匹配资产。',
  },
  {
    icon: Clock,
    title: '数据保留策略',
    desc: 'SQLite 存储，报告保留 30 天，删除项目会级联删除关联报告。',
  },
  {
    icon: Server,
    title: '容器部署注意',
    desc: '生产环境使用 docker-compose 部署，数据卷挂载 ./data 目录持久化 SQLite。',
  },
]

function FeatureCard({ icon: Icon, title, desc }) {
  return (
    <div className="bg-ds-surface rounded-[18px] border border-ds-border p-6 sm:p-8 transition-colors hover:border-ds-accent/30">
      <div className="w-10 h-10 rounded-xl bg-ds-accent/10 flex items-center justify-center mb-4">
        <Icon className="w-5 h-5 text-ds-accent" />
      </div>
      <h3 className="text-base font-semibold text-ds-text mb-2 tracking-tight-apple">{title}</h3>
      <p className="text-sm text-ds-muted leading-relaxed">{desc}</p>
    </div>
  )
}

function StepItem({ num, title, desc, icon: Icon }) {
  return (
    <div className="relative flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-2xl bg-ds-surface border border-ds-border flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-ds-accent" />
      </div>
      <span className="text-xs font-mono text-ds-accent mb-1">{num}</span>
      <h4 className="text-sm font-semibold text-ds-text mb-1">{title}</h4>
      <p className="text-xs text-ds-muted max-w-[200px]">{desc}</p>
    </div>
  )
}

function NoteItem({ icon: Icon, title, desc }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-ds-surface2 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-ds-muted" />
      </div>
      <div>
        <h4 className="text-sm font-medium text-ds-text mb-0.5">{title}</h4>
        <p className="text-xs text-ds-muted leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <div className="space-y-20 sm:space-y-28">
      {/* ── Hero ── */}
      <section className="text-center pt-8 sm:pt-12">
        <div className="relative inline-block mb-6">
          <div className="w-16 h-16 rounded-2xl bg-ds-accent/10 flex items-center justify-center mx-auto mb-6">
            <ShieldCheck className="w-8 h-8 text-ds-accent" />
          </div>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold text-ds-text tracking-tight-display mb-4 leading-tight">
          dm-inspect
        </h1>
        <p className="text-base sm:text-lg text-ds-muted max-w-2xl mx-auto mb-2 leading-relaxed">
          基于标签驱动的自动化巡检系统
        </p>
        <p className="text-sm text-ds-muted/80 max-w-xl mx-auto mb-8">
          对接 VictoriaMetrics 指标查询与 Nightingale (N9E) 资产/告警数据，生成结构化 Markdown 巡检报告
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/projects/quick-new">
            <Button size="lg">
              快速创建巡检
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Link to="/projects">
            <Button variant="outline" size="lg">
              查看巡检项目
            </Button>
          </Link>
        </div>
      </section>

      {/* ── 功能特性 ── */}
      <section>
        <div className="text-center mb-10 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-ds-text tracking-tight-apple mb-3">
            功能特性
          </h2>
          <p className="text-sm text-ds-muted">六大核心能力，覆盖服务器到中间件的全链路巡检</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {FEATURES.map(f => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </section>

      {/* ── 使用方式 ── */}
      <section>
        <div className="text-center mb-10 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-ds-text tracking-tight-apple mb-3">
            使用方式
          </h2>
          <p className="text-sm text-ds-muted">四步完成从创建到报告的完整巡检流程</p>
        </div>
        <div className="bg-ds-surface rounded-[18px] border border-ds-border p-8 sm:p-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STEPS.map((step, idx) => (
              <div key={step.num} className="relative">
                <StepItem {...step} />
                {idx < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-7 left-[calc(50%+28px)] w-[calc(100%-56px)]">
                    <div className="h-px bg-ds-border w-full" />
                    <ArrowRight className="w-3 h-3 text-ds-border absolute -right-1 -top-1.5" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 注意事项 ── */}
      <section>
        <div className="text-center mb-10 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-ds-text tracking-tight-apple mb-3">
            注意事项
          </h2>
          <p className="text-sm text-ds-muted">部署和使用前需要了解的关键事项</p>
        </div>
        <div className="bg-ds-surface rounded-[18px] border border-ds-border p-6 sm:p-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {NOTES.map(n => (
              <NoteItem key={n.title} {...n} />
            ))}
          </div>
        </div>
      </section>

      {/* ── 技术栈 ── */}
      <section>
        <div className="text-center mb-10 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-ds-text tracking-tight-apple mb-3">
            技术栈
          </h2>
          <p className="text-sm text-ds-muted">轻量、高效、易部署的技术选型</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {[
            'Go + Gin',
            'React 18',
            'TailwindCSS',
            'SQLite',
            'VictoriaMetrics',
            'Nightingale',
            'Docker',
            'Jenkins',
          ].map(tag => (
            <span
              key={tag}
              className="px-4 py-1.5 rounded-full text-sm font-medium bg-ds-surface border border-ds-border text-ds-text"
            >
              {tag}
            </span>
          ))}
        </div>
      </section>

      {/* ── 底部 CTA ── */}
      <section className="text-center pb-8">
        <div className="bg-ds-accent/5 rounded-[18px] border border-ds-accent/20 p-8 sm:p-12">
          <CheckCircle2 className="w-10 h-10 text-ds-accent mx-auto mb-4" />
          <h2 className="text-xl sm:text-2xl font-bold text-ds-text tracking-tight-apple mb-2">
            开始您的第一次巡检
          </h2>
          <p className="text-sm text-ds-muted mb-6 max-w-md mx-auto">
            三步完成项目创建，系统自动生成昨日巡检报告
          </p>
          <Link to="/projects/quick-new">
            <Button size="lg">
              立即开始
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  )
}
