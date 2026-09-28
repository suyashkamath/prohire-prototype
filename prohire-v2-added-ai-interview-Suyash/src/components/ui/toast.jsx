import { useRef, useState, useCallback } from 'react'
import { ToastCtx } from './toastContext.js'

export function ToastHost({ children }) {
  const [items, setItems] = useState([])
  const idRef = useRef(0)

  const push = useCallback((message, tone = '') => {
    const id = ++idRef.current
    setItems((xs) => [...xs, { id, message, tone }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.message}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}
