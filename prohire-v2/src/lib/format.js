// Display helpers. Nothing here makes a decision; it only renders one.

export function formatDate(iso, opts = {}) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', ...opts })
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })
}

/** "3 hours ago" — recruiters scan lists by recency, not by date. */
export function relative(iso) {
  if (!iso) return '—'
  const secs = (Date.now() - new Date(iso).getTime()) / 1000
  const past = secs >= 0
  const s = Math.abs(secs)
  const steps = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [604800, 'day', 86400],
    [2629800, 'week', 604800],
    [31557600, 'month', 2629800],
  ]
  for (const [limit, unit, div] of steps) {
    if (s < limit) {
      const n = Math.floor(s / div)
      if (unit === 'second' && n < 10) return 'just now'
      return past ? `${n} ${unit}${n === 1 ? '' : 's'} ago` : `in ${n} ${unit}${n === 1 ? '' : 's'}`
    }
  }
  const n = Math.floor(s / 31557600)
  return past ? `${n} year${n === 1 ? '' : 's'} ago` : `in ${n} year${n === 1 ? '' : 's'}`
}

export function mmss(seconds) {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase() || '?'
}

export const lpa = (n) => (n == null ? '—' : `₹${n} LPA`)

export function titleCase(s = '') {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
