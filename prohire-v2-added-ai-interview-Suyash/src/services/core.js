// Shared service-layer plumbing: activity logging, settings, and the session
// of the logged-in recruiter.
//
// Dependency direction, same rule as V1: screens → services → db. A screen
// never touches `db` directly, and a service never renders anything.

import { db } from '../lib/db.js'
import { newId, nowIso } from '../lib/ids.js'
import { DEFAULT_PERSONA_NAME } from '../domain/resolvePlan.js'
import { DEFAULT_TEMPLATES } from '../domain/emailTemplates.js'

const AUTH_KEY = 'prohire.v2.session'

export const SETTINGS_ID = 'org'

// The vendor's interviewer is called Erica; ours must not be. Older data used
// "Erika" as the default, so that value is treated as "not chosen yet".
const LEGACY_PERSONA_NAMES = ['Erika', 'Erica']

export function getSettings() {
  const saved = db.findOne('settings', SETTINGS_ID)
  if (saved && LEGACY_PERSONA_NAMES.includes(saved.persona_name)) saved.persona_name = DEFAULT_PERSONA_NAME
  return (
    saved ?? {
      _id: SETTINGS_ID,
      org_name: 'Probus Insurance',
      match_threshold: 72,
      persona_name: DEFAULT_PERSONA_NAME,
      interview: {},
      retention_days: 180,
    }
  )
}

export function updateSettings(patch) {
  const current = getSettings()
  if (db.findOne('settings', SETTINGS_ID)) {
    return db.update('settings', SETTINGS_ID, patch)
  }
  return db.insert('settings', { ...current, ...patch, updated_at: nowIso() })
}

/** An email template: the org's saved edit if there is one, else the default. */
export function getEmailTemplate(key) {
  return { ...DEFAULT_TEMPLATES[key], ...(getSettings().email_templates?.[key] ?? {}) }
}

export function saveEmailTemplate(key, patch) {
  const current = getSettings().email_templates ?? {}
  return updateSettings({ email_templates: { ...current, [key]: { ...(current[key] ?? {}), ...patch } } })
}

export function resetEmailTemplate(key) {
  const { [key]: _drop, ...rest } = getSettings().email_templates ?? {}
  return updateSettings({ email_templates: rest })
}

/**
 * Append-only audit. When someone asks "who rejected this candidate and when",
 * the answer is in the data, not in a log that rotated away.
 */
export function logActivity({ type, subject_type, subject_id, summary, by, meta }) {
  return db.insert('activity', {
    _id: newId(),
    type,
    subject_type,
    subject_id,
    summary,
    by: by ?? currentUser()?.username ?? 'system',
    meta: meta ?? null,
    at: nowIso(),
  })
}

export function activityFor(subject_type, subject_id) {
  return db
    .find('activity', { subject_type, subject_id })
    .sort((a, b) => b.at.localeCompare(a.at))
}

export function recentActivity(limit = 20) {
  return db.all('activity').sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

// --- auth ------------------------------------------------------------------
//
// There is no server, so there is no real authentication here and the code says
// so rather than pretending. This gates the console behind a named user so that
// `created_by` and `stage_history.by` carry a real name — which is the part the
// product actually depends on.

export function currentUser() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY) ?? localStorage.getItem(AUTH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function signIn({ username, remember }) {
  const name = String(username || '').trim().toLowerCase()
  if (!name) throw new Error('Enter a username.')
  let user = db.findOne('recruiters', { username: name })
  if (!user) {
    user = db.insert('recruiters', {
      _id: newId(),
      username: name,
      full_name: name.charAt(0).toUpperCase() + name.slice(1),
      role: db.all('recruiters').length === 0 ? 'admin' : 'recruiter',
      created_at: nowIso(),
    })
  }
  const store = remember ? localStorage : sessionStorage
  store.setItem(AUTH_KEY, JSON.stringify(user))
  return user
}

export function signOut() {
  sessionStorage.removeItem(AUTH_KEY)
  localStorage.removeItem(AUTH_KEY)
}
