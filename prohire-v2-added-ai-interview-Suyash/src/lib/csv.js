// Spreadsheet export. CSV with a BOM, so Excel opens it with Hindi, Tamil and
// ₹ intact instead of mojibake.

function cell(v) {
  if (v == null) return ''
  const s = Array.isArray(v) ? v.join(', ') : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(columns, rows) {
  const head = columns.map((c) => cell(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(','))
  return [head, ...body].join('\r\n')
}

export function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type })
  downloadBlob(filename, blob)
}

export function downloadBlob(filename, blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function downloadCsv(filename, columns, rows) {
  downloadText(filename, '﻿' + toCsv(columns, rows), 'text/csv;charset=utf-8')
}
