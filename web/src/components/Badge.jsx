import { cn } from "@/lib/utils"
import { badgeVariants } from "@/components/ui/badge"

const CONFIG = {
  completed: { label: '已完成', cls: 'bg-ds-accent/10 text-ds-accent border-transparent' },
  partial:   { label: '部分完成', cls: 'bg-amber-500/10 text-amber-400 border-transparent' },
  error:     { label: '失败',   cls: 'bg-red-500/10 text-red-400 border-transparent' },
  pending:   { label: '进行中', cls: 'bg-amber-500/10 text-amber-400 border-transparent' },
}

export default function Badge({ status }) {
  const cfg = CONFIG[status] || { label: status, cls: 'bg-ds-surface2 text-ds-muted border-transparent' }
  return (
    <span className={cn(badgeVariants({ variant: 'outline' }), 'hover:bg-transparent', cfg.cls)}>
      {status === 'pending' && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      )}
      {cfg.label}
    </span>
  )
}
