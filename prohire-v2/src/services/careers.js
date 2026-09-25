// Intake from outside the console: the company's OFFICIAL career page, and
// the Chrome-extension import.
//
// ProHire does not host a career page. The official site keeps its own look
// and simply (1) reads the jobs ProHire publishes and (2) forwards every
// application here. `applyToJob` is that intake — in the real deployment it
// sits behind POST /api/v1/career-portal/applications (see
// docs/career-portal-integration.md at the repo root).
//
// Both routes go through the same ingest pipeline as an uploaded resume —
// dedupe included. A candidate who applies on the career page after a
// recruiter already pulled them from Naukri becomes one person with two
// sources, not two people.

import { db } from '../lib/db.js'
import { nowIso } from '../lib/ids.js'
import { normalizeEmail, normalizePhone } from '../domain/parsing.js'
import { parsePortalProfile, looksLikePortalProfile } from '../domain/portalProfile.js'
import { ingestResume, createCandidate, resolveIdentity, getCandidate } from './candidates.js'
import { createApplication } from './applications.js'
import { getJob } from './jobs.js'
import { logActivity } from './core.js'

export async function applyToJob({ job_id, full_name, email, phone, city, total_experience_years, resume_text, consent }) {
  const job = getJob(job_id)
  if (!job || job.status !== 'active' || !job.publish?.career_portal) {
    throw new Error('This job is no longer accepting applications.')
  }
  if (!full_name?.trim()) throw new Error('Please enter your name.')
  if (!normalizeEmail(email) && !normalizePhone(phone)) throw new Error('Please enter an email address or a phone number.')
  if (!consent) throw new Error('Please agree to the data consent to apply.')
  return finishApply({ job, full_name, email, phone, city, total_experience_years, resume_text })
}

async function finishApply({ job, full_name, email, phone, city, total_experience_years, resume_text }) {
  const source = { channel: 'career_portal', detail: job.reference, by: 'candidate' }

  // The form fields are what the candidate told us directly, so they win over
  // anything parsed out of the pasted resume.
  const header = [full_name, email, phone, city].filter(Boolean).join(' | ')
  const text = resume_text?.trim() ? `${header}\n\n${resume_text.trim()}` : null

  let candidate
  if (text) {
    const res = await ingestResume({ filename: `career-portal-${job.reference}.txt`, text, source, extra: { full_name } })
    candidate = res.candidate
  } else {
    const identity = resolveIdentity({ email: normalizeEmail(email), phone: normalizePhone(phone), full_name })
    candidate = identity.action === 'merge'
      ? identity.candidate
      : createCandidate({ full_name, email, phone, total_experience_years }, { source })
  }

  const patch = {
    consent: { ...(getCandidate(candidate._id).consent ?? {}), data_processing: 'granted', captured_at: nowIso(), via: 'career_portal' },
  }
  if (city && !candidate.location?.city) patch.location = { state: null, city }
  if (total_experience_years !== '' && total_experience_years != null && candidate.total_experience_years == null) {
    patch.total_experience_years = Number(total_experience_years)
  }
  db.update('candidates', candidate._id, patch)

  const { application, created } = createApplication({ candidate_id: candidate._id, job_id: job._id, source })
  logActivity({
    type: 'application.career_portal',
    subject_type: 'job',
    subject_id: job._id,
    summary: `${full_name} applied to ${job.reference} via the career portal`,
    by: 'candidate',
  })
  return { application, created, candidate: getCandidate(candidate._id) }
}

/**
 * Decode what the Chrome extension sends. It opens `/import#<base64url JSON>`
 * with `{ source, url, name, headline, location, text }` scraped from a
 * LinkedIn or Naukri profile.
 */
export function decodeImport(hash) {
  const raw = String(hash ?? '').replace(/^#/, '')
  if (!raw) return null
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const data = JSON.parse(new TextDecoder().decode(bytes))
  if (!data || typeof data.text !== 'string') throw new Error('The extension sent something this page does not understand.')
  return {
    source: ['linkedin', 'naukri'].includes(data.source) ? data.source : 'linkedin',
    url: data.url ?? null,
    name: data.name ?? null,
    headline: data.headline ?? null,
    location: data.location ?? null,
    text: data.text.slice(0, 60_000),
  }
}

/** What an import will produce — used for the preview and the import itself. */
export function previewPortalImport(payload) {
  const header = [payload.name, payload.headline, payload.location].filter(Boolean).join('\n')
  const text = header ? `${header}\n\n${payload.text}` : payload.text
  const profile = payload.source === 'naukri' || looksLikePortalProfile(text) ? parsePortalProfile(text) : null
  return { text, profile }
}

export async function importFromPortal(payload, { job_id } = {}) {
  const { text, profile } = previewPortalImport(payload)
  const res = await ingestResume({
    filename: `${payload.source}-profile.txt`,
    text,
    source: { channel: payload.source, detail: payload.url, by: 'extension' },
    extra: {
      full_name: payload.name,
      profile,
      links: payload.url ? { [payload.source]: payload.url } : {},
    },
  })
  let application = null
  if (job_id) {
    application = createApplication({
      candidate_id: res.candidate._id,
      job_id,
      source: { channel: payload.source, detail: payload.url, by: 'extension' },
    }).application
  }
  return { ...res, application }
}
