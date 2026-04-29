import { cn } from "@/lib/utils"
import { badgeVariants } from "@/components/ui/badge"

const CONFIG = {
  completed: { label: '已完成', cls: 'bg-ds-accent/10 text-ds-accent border-ds-accent/20' },
  partial:   { label: '部分完成', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400 dark:border-amber-500/20' },
  error:     { label: '失败',   cls: 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400 dark:border-red-500/20' },
  pending:   { label: '进行中', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400 dark:border-amber-500/20' },
}

export default function Badge({ status }) {
  const cfg = CONFIG[status] || { label: status, cls: 'bg-ds-surface2 text-ds-muted border-ds-border' }
  return (
    <span className={cn(badgeVariants({ variant: 'outline' }), 'hover:bg-transparent rounded-full text-xs font-medium px-2.5 py-0.5', cfg.cls)}>
      {status === 'pending' && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse mr-1" />
      )}
      {cfg.label}
    </span>
  )
}
