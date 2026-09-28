// Applications (§9.5) — the join between a candidate and a job, and the busiest
// collection in the system.
//
// Two rules are load-bearing here:
//   1. UNIQUE on (candidate_id, job_id). Re-applying re-opens the existing row
//      and appends to stage_history; it never creates a second one.
//   2. The recruiter moves the stage. `moveStage` is the ONLY way a stage
//      changes, and the two system-owned transitions go through
//      `systemMoveStage`, which is called by the interview engine alone.

import { db } from '../lib/db.js'
import { newId, nowIso } from '../lib/ids.js'
import { screenResume } from '../domain/ai.js'
import { currentUser, logActivity } from './core.js'
import { getCandidate } from './candidates.js'
import { getJob } from './jobs.js'

export function listApplications({ job_id, candidate_id, stage, sort = 'updated' } = {}) {
  let rows = db.all('applications')
  if (job_id) rows = rows.filter((a) => a.job_id === job_id)
  if (candidate_id) rows = rows.filter((a) => a.candidate_id === candidate_id)
  if (stage) rows = rows.filter((a) => (Array.isArray(stage) ? stage.includes(a.stage) : a.stage === stage))

  const sorters = {
    // Relevance rank is a SORT, never a gate (§14.5). The recruiter still sees
    // every row.
    score: (a, b) => (b.screening?.match_percent ?? -1) - (a.screening?.match_percent ?? -1),
    interview: (a, b) => (b.interview_summary?.overall_score ?? -1) - (a.interview_summary?.overall_score ?? -1),
    name: (a, b) => a.candidate_name.localeCompare(b.candidate_name),
    updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
  }
  return rows.sort(sorters[sort] ?? sorters.updated)
}

export function getApplication(id) {
  return db.findOne('applications', id)
}

/**
 * Tag a candidate to a job. Idempotent by design — the unique constraint means
 * "did we already talk to them about this role?" is a one-lookup answer.
 */
export function createApplication({ candidate_id, job_id, source }) {
  const existing = db.findOne('applications', { candidate_id, job_id })
  if (existing) return { application: existing, created: false }

  const candidate = getCandidate(candidate_id)
  const job = getJob(job_id)
  if (!candidate || !job) throw new Error('Candidate and job must both exist.')

  const by = currentUser()?.username ?? 'system'
  const app = db.insert('applications', {
    _id: newId(),
    candidate_id,
    job_id,

    // Denormalised for list rendering: a pipeline of 200 rows is one read,
    // not 200 lookups.
    candidate_name: candidate.full_name,
    candidate_email: candidate.email,
    job_reference: job.reference,
    job_title: job.title,

    stage: 'sourced',
    stage_history: [{ stage: 'sourced', at: nowIso(), by }],

    screening: null,
    interview_summary: null,
    interview_override: null,
    interest: null,
    notes: [],

    // Where this application came from — shown on the pipeline row. Defaults
    // to where the candidate themselves came from.
    source: source ?? { channel: candidate.source?.channel ?? 'manual_entry', by },
    created_at: nowIso(),
    updated_at: nowIso(),
  })

  logActivity({
    type: 'application.created',
    subject_type: 'application',
    subject_id: app._id,
    summary: `${candidate.full_name} → ${job.reference}`,
  })
  return { application: app, created: true }
}

/** The only way a stage moves by hand. */
export function moveStage(id, stage, note) {
  const app = getApplication(id)
  if (!app) throw new Error('Application not found.')
  if (app.stage === stage) return app

  const by = currentUser()?.username ?? 'system'
  const doc = db.update('applications', id, {
    stage,
    stage_history: [...app.stage_history, { stage, at: nowIso(), by, note: note ?? null }],
  })
  logActivity({
    type: 'application.stage',
    subject_type: 'application',
    subject_id: id,
    summary: `${app.candidate_name} → ${stage}`,
    meta: { from: app.stage, to: stage, note: note ?? null },
  })
  return doc
}

/**
 * The two transitions the system owns (§5.2). Called by the interview engine
 * only — a session that starts or finishes is a fact, not a judgement.
 */
export function systemMoveStage(id, stage) {
  const app = getApplication(id)
  if (!app || app.stage === stage) return app
  return db.update('applications', id, {
    stage,
    stage_history: [...app.stage_history, { stage, at: nowIso(), by: 'system' }],
  })
}

/** Take a candidate off a job. The candidate stays in the database. */
export function removeApplication(id) {
  const app = getApplication(id)
  if (!app) return false
  db.remove('applications', id)
  logActivity({
    type: 'application.removed',
    subject_type: 'candidate',
    subject_id: app.candidate_id,
    summary: `${app.candidate_name} removed from ${app.job_reference}`,
  })
  return true
}

/**
 * Move a candidate to a different job. The old application is closed as
 * withdrawn — not deleted — so "we considered her for IT-0003 first" stays
 * on the record.
 */
export function moveToJob(id, targetJobId, note) {
  const app = getApplication(id)
  if (app.job_id === targetJobId) return { application: app, created: false }
  const target = getJob(targetJobId)
  const out = createApplication({
    candidate_id: app.candidate_id,
    job_id: targetJobId,
    source: { ...(app.source ?? {}), moved_from: app.job_reference },
  })
  // Carry the notes across; screening is per-job and is not.
  if (out.created && app.notes?.length) db.update('applications', out.application._id, { notes: app.notes })
  moveStage(id, 'withdrawn', note || `Moved to ${target.reference}`)
  return out
}

export function addNote(id, text) {
  const app = getApplication(id)
  const note = { text: text.trim(), by: currentUser()?.username ?? 'system', at: nowIso() }
  return db.update('applications', id, { notes: [...(app.notes ?? []), note] })
}

// --- AI #1 -----------------------------------------------------------------

/**
 * Screen one application.
 *
 * The threshold is a BUSINESS RULE applied here, not the model's opinion: a
 * score below the job's threshold is a forced Reject and the reason says so
 * explicitly. The model produces the number; the business decides what the
 * number means.
 */
export async function screenApplication(id) {
  const app = getApplication(id)
  const job = getJob(app.job_id)
  const candidate = getCandidate(app.candidate_id)

  const result = await screenResume({ job, candidate, resumeText: candidate.resume_text ?? '' })
  const threshold = job.screening_profile?.match_threshold ?? 72
  const passed = result.match_percent >= threshold

  const details = [
    `Match: ${result.match_percent}%  (threshold ${threshold}%)`,
    '',
    'Pros:',
    ...result.pros.map((p) => `- ${p}`),
    '',
    'Cons:',
    ...result.cons.map((c) => `- ${c}`),
    '',
    passed
      ? `Suggestion: good fit — at or above the ${threshold}% bar for ${job.reference}.`
      : `Suggestion: not a strong fit — ${result.match_percent}% is below the ${threshold}% bar for ${job.reference}. This is the threshold rule, not a judgement about the candidate; the call is yours.`,
  ].join('\n')

  const screening = {
    match_percent: result.match_percent,
    decision: passed ? 'Shortlisted' : 'Rejected',
    breakdown: result.breakdown,
    matched_skills: result.matched_skills,
    missing_skills: result.missing_skills,
    pros: result.pros,
    cons: result.cons,
    details,
    threshold_applied: threshold,
    screened_at: nowIso(),
    model: result.model,
  }

  db.update('applications', id, { screening })

  logActivity({
    type: 'application.screened',
    subject_type: 'application',
    subject_id: id,
    summary: `${app.candidate_name} screened ${result.match_percent}% against ${job.reference}`,
    by: 'system',
  })

  // Note what did NOT happen: the stage did not move. Screening produces a
  // number and a suggestion; advancing to `screened` stays a recruiter's click
  // (§5.2).
  return { ...app, screening }
}

/**
 * Batch screening with BOUNDED concurrency (§22.1).
 *
 * Five at a time. Sequential would take ~6 minutes for 50 resumes; this takes
 * ~75 seconds. Unbounded would trip rate limits and end up slower than both.
 */
export async function screenBatch(ids, { concurrency = 5, onProgress } = {}) {
  const results = []
  let done = 0
  const queue = [...ids]

  async function worker() {
    while (queue.length) {
      const id = queue.shift()
      try {
        const app = await screenApplication(id)
        results.push({ id, ok: true, match: app.screening.match_percent, decision: app.screening.decision })
      } catch (err) {
        results.push({ id, ok: false, error: err.message })
      }
      onProgress?.(++done, ids.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker))
  return results
}

// --- the optional interest check (§17.2) -----------------------------------

export function sendInterestCheck(id) {
  const app = getApplication(id)
  const token = newId()
  const interest = { token, sent_at: nowIso(), responded_at: null, response: null }
  db.update('applications', id, { interest })
  moveStage(id, 'interest_sent', 'Interest email sent')
  logActivity({
    type: 'application.interest_sent',
    subject_type: 'application',
    subject_id: id,
    summary: `Interest check sent to ${app.candidate_name}`,
  })
  return { token, url: `${location.origin}/interest/${token}` }
}

export function findByInterestToken(token) {
  return db.all('applications').find((a) => a.interest?.token === token) ?? null
}

export function recordInterest(token, response) {
  const app = findByInterestToken(token)
  if (!app) throw new Error('This link is not valid.')
  if (app.interest.responded_at) return app

  db.update('applications', app._id, {
    interest: { ...app.interest, responded_at: nowIso(), response },
  })
  // The candidate's own answer is the one stage change they cause. It is still
  // recorded as theirs, not the recruiter's.
  const stage = response === 'interested' ? 'interested' : 'not_interested'
  const doc = db.update('applications', app._id, {
    stage,
    stage_history: [...app.stage_history, { stage, at: nowIso(), by: 'candidate' }],
  })
  logActivity({
    type: 'application.interest_response',
    subject_type: 'application',
    subject_id: app._id,
    summary: `${app.candidate_name} replied: ${response.replace('_', ' ')}`,
    by: 'candidate',
  })
  return doc
}
