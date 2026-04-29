import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = {
  success: <CheckCircle2 className="w-5 h-5 text-ds-accent shrink-0" />,
  error: <XCircle className="w-5 h-5 text-red-500 shrink-0" />,
  info: <Info className="w-5 h-5 text-ds-accent shrink-0" />,
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counterRef = useRef(0)
  const timersRef = useRef(new Map())

  useEffect(() => {
    return () => {
      timersRef.current.forEach(timerId => clearTimeout(timerId))
      timersRef.current.clear()
    }
  }, [])

  const dismiss = useCallback((id) => {
    if (timersRef.current.has(id)) {
      clearTimeout(timersRef.current.get(id))
      timersRef.current.delete(id)
    }
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const add = useCallback((type, message) => {
    const id = ++counterRef.current
    setToasts(prev => [...prev, { id, type, message }])
    const timerId = setTimeout(() => dismiss(id), 3000)
    timersRef.current.set(id, timerId)
  }, [dismiss])

  const toast = {
    success: (msg) => add('success', msg),
    error:   (msg) => add('error', msg),
    info:    (msg) => add('info', msg),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
        {toasts.map(t => (
          <div key={t.id}
            className="flex items-center gap-3 bg-ds-surface border border-ds-border rounded-xl px-4 py-3"
          >
            {ICONS[t.type]}
            <p className="flex-1 text-sm text-ds-text">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-ds-muted hover:text-ds-text transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
