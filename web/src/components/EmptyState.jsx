import { FileText } from 'lucide-react'

export default function EmptyState({ title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-ds-surface2 flex items-center justify-center mb-5">
        <FileText className="w-7 h-7 text-ds-muted" />
      </div>
      <h3 className="text-lg font-semibold text-ds-text tracking-tight-apple mb-1.5">{title}</h3>
      {description && <p className="text-sm text-ds-muted mb-5 max-w-sm leading-relaxed">{description}</p>}
      {action}
    </div>
  )
}
