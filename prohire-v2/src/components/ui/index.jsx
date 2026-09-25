// Shared UI primitives. No business logic lives here — these know how something
// looks, never what it means.

import { useEffect, useRef, useState } from 'react'

export function Card({ title, actions, children, footer, className = '', ...rest }) {
  return (
    <div className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row" style={{ marginLeft: 'auto' }}>{actions}</div>}
        </div>
      )}
      {children && <div className="card-body">{children}</div>}
      {footer && <div className="card-foot">{footer}</div>}
    </div>
  )
}

export function Stat({ value, label, tone, onClick }) {
  return (
    <div className={`card stat ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

export function Badge({ tone = 'neutral', children, className = '', ...rest }) {
  const cls = tone === 'neutral' ? '' : tone
  return <span className={`badge ${cls} ${className}`} {...rest}>{children}</span>
}

export function Field({ label, hint, error, children, ...rest }) {
  return (
    <div className="field" {...rest}>
      {label && <label>{label}</label>}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function Select({ options, value, onChange, placeholder, ...rest }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value
        const lab = typeof o === 'string' ? o : o.label
        return <option key={val} value={val}>{lab}</option>
      })}
    </select>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`tab ${value === t.key ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.count != null && <span className="dim"> {t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Modal({ title, children, onClose, footer, wide }) {
  // Escape closes. A modal you cannot dismiss with the keyboard is a trap.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        {title && (
          <div className="modal-head between">
            {typeof title === 'string' ? <h2>{title}</h2> : title}
            <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="muted" style={{ maxWidth: 440, margin: '0 auto 14px' }}>{children}</p>}
      {action}
    </div>
  )
}

export function Bar({ value, max = 100, tone }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const auto = pct >= 70 ? 'good' : pct >= 45 ? 'warn' : 'bad'
  return (
    <div className={`bar ${tone ?? auto}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Match({ value }) {
  if (value == null) return <span className="dim">—</span>
  const tone = value >= 70 ? 'good' : value >= 50 ? 'warn' : 'bad'
  return <span className={`match ${tone}`}>{value}%</span>
}

export function Spinner({ label }) {
  return (
    <span className="row small muted">
      <span className="spin" />
      {label}
    </span>
  )
}

/** Copy-to-clipboard that tells you it worked. Used for every generated link. */
export function CopyButton({ text, label = 'Copy link', className = 'btn sm' }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          // Clipboard is blocked outside a secure context; fall back to select.
          window.prompt('Copy this link:', text)
        }
        setDone(true)
        setTimeout(() => setDone(false), 1600)
      }}
    >
      {done ? '✓ Copied' : label}
    </button>
  )
}

/** A confirm dialog, because window.confirm cannot explain consequences. */
export function Confirm({ title, body, confirmLabel = 'Confirm', tone = '', onConfirm, onClose }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${tone || 'primary'}`} onClick={() => { onConfirm(); onClose() }}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {body}
    </Modal>
  )
}

/**
 * A "⋯" actions menu. Items are `{ label, onClick, tone?, disabled?, hint? }`
 * or the string '-' for a divider. Closes on outside click and on Escape.
 */
export function Menu({ items, label = '⋯', title = 'More actions', align = 'right', className = 'btn ghost sm' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <span className="menu" ref={ref}>
      <button
        type="button" className={className} aria-haspopup="menu" aria-expanded={open} title={title}
        onClick={(e) => {
          e.stopPropagation()
          // Fixed positioning, so a menu inside a scrolling table is never
          // clipped. Opens upward when there is no room below.
          const r = e.currentTarget.getBoundingClientRect()
          const below = window.innerHeight - r.bottom
          const up = below < 360 && r.top > below
          setPos({
            top: up ? undefined : r.bottom + 4,
            bottom: up ? window.innerHeight - r.top + 4 : undefined,
            maxHeight: (up ? r.top : below) - 12,
            right: align === 'right' ? window.innerWidth - r.right : undefined,
            left: align === 'left' ? r.left : undefined,
          })
          setOpen((o) => !o)
        }}
      >
        {label}
      </button>
      {open && (
        <div className="menu-pop" style={pos ?? undefined} role="menu" onClick={(e) => e.stopPropagation()}>
          {items.filter(Boolean).map((it, i) =>
            it === '-' ? <div key={i} className="menu-sep" /> : (
              <button
                key={i} type="button" role="menuitem" disabled={it.disabled}
                className={`menu-item ${it.tone ?? ''}`} title={it.hint}
                onClick={() => { setOpen(false); it.onClick?.() }}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </span>
  )
}
