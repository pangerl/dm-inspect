const CONFIG = {
  completed: { label: '已完成', cls: 'bg-ds-accent/10 text-ds-accent' },
  partial:   { label: '部分完成', cls: 'bg-amber-500/10 text-amber-400' },
  error:     { label: '失败',   cls: 'bg-red-500/10 text-red-400' },
  pending:   { label: '进行中', cls: 'bg-amber-500/10 text-amber-400' },
}

export default function Badge({ status }) {
  const cfg = CONFIG[status] || { label: status, cls: 'bg-ds-surface2 text-ds-muted' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      {status === 'pending' && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      )}
      {cfg.label}
    </span>
  )
}
