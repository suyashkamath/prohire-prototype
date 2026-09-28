import { createContext, useContext } from 'react'

export const ToastCtx = createContext(() => {})

/** push(message, tone) where tone is '' | 'good' | 'bad'. */
export const useToast = () => useContext(ToastCtx)
