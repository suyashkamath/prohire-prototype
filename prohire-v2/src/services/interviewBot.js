// Talking to the InterviewBot server — the separate service that runs the AI
// voice call (see InterviewBot/README.md). Its address is a setting
// (Settings → AI voice interview); the Sarvam keys stay on that server and
// never reach this browser.

import { getSettings } from './core.js'

export const DEFAULT_BOT_URL = 'http://localhost:8000'

export const botUrl = () => String(getSettings().interview_bot_url || DEFAULT_BOT_URL).replace(/\/+$/, '')

async function call(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  let res
  try {
    res = await fetch(`${botUrl()}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
  } catch {
    throw new Error(`The AI voice interview server (${botUrl()}) can't be reached. Start it, or check its address in Settings.`)
  } finally {
    clearTimeout(t)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `The interview server said no (${res.status}).`)
  return data
}

/** Is the server up, does it have its Sarvam keys, and can it send email? */
export async function botStatus() {
  try {
    const s = await call('/api/status', { timeout: 4000 })
    return { reachable: true, ready: s.ready, missing: s.missing ?? [], email: Boolean(s.email) }
  } catch (err) {
    return { reachable: false, ready: false, missing: [], email: false, error: err.message }
  }
}

export const createBotSession = (botPlan) => call('/api/prohire/sessions', { method: 'POST', body: botPlan })
export const fetchBotSession = (id) => call(`/api/sessions/${id}`)
export const updateBotInvite = (id, patch) => call(`/api/prohire/sessions/${id}/invite`, { method: 'POST', body: patch })
export const regenerateBotReport = (id) => call(`/api/sessions/${id}/report`, { method: 'POST', timeout: 300000 })
export const emailBotInvite = (id, email) =>
  call(`/api/prohire/sessions/${id}/email`, { method: 'POST', body: email, timeout: 45000 })
