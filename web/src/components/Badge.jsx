const CONFIG = {
  completed: { label: '已完成', cls: 'bg-green-100 text-green-800' },
  partial:   { label: '部分完成', cls: 'bg-orange-100 text-orange-800' },
  error:     { label: '失败',   cls: 'bg-red-100 text-red-800' },
  pending:   { label: '进行中', cls: 'bg-yellow-100 text-yellow-800' },
}

export default function Badge({ status }) {
  const cfg = CONFIG[status] || { label: status, cls: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      {status === 'pending' && (
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
      )}
      {cfg.label}
    </span>
  )
}
