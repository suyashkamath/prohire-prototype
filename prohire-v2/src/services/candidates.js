// Candidates (§9.4) and the ingest pipeline (§13).
//
// A candidate exists ONCE, no matter how many jobs they touch. Creating one
// tags no job — tagging is a separate, explicit action that creates an
// application. That separation is what makes the universal pool a pool rather
// than a pile of per-job duplicates.

import { db } from '../lib/db.js'
import { newId, nowIso } from '../lib/ids.js'
import { parseResume, normalizeEmail, normalizePhone, textHash } from '../domain/parsing.js'
import { currentUser, logActivity } from './core.js'

/**
 * Keyword search over the pool, the way a recruiter searches Naukri: every word
 * must appear somewhere — name, ID, contact details, skills, current role,
 * city, or anywhere in the resume text. "sales pune insurance" finds sales
 * people in Pune with insurance on their resume.
 */
export function listCandidates({ q, skill, tag, city, source, minExp, maxExp, flagged } = {}) {
  let rows = db.all('candidates').filter((c) => !c.merged_into)
  if (q) {
    const words = q.toLowerCase().split(/[\s,]+/).filter(Boolean)
    rows = rows.filter((c) => {
      const hay = searchText(c)
      return words.every((w) => hay.includes(w))
    })
  }
  if (skill) rows = rows.filter((c) => (c.parsed?.skills ?? []).includes(skill))
  if (tag) rows = rows.filter((c) => (c.tags ?? []).includes(tag))
  if (city) rows = rows.filter((c) => c.location?.city === city)
  if (source) rows = rows.filter((c) => c.source?.channel === source)
  if (minExp !== '' && minExp != null) rows = rows.filter((c) => (c.total_experience_years ?? -1) >= Number(minExp))
  if (maxExp !== '' && maxExp != null) rows = rows.filter((c) => c.total_experience_years != null && c.total_experience_years <= Number(maxExp))
  if (flagged) rows = rows.filter((c) => c.flag)
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

function searchText(c) {
  return [
    c.reference, c.full_name, c.email, c.phone, c.current?.title, c.current?.company,
    c.location?.city, c.location?.state, c.primary_skill, ...(c.parsed?.skills ?? []),
    ...(c.tags ?? []), c.resume_text,
  ].filter(Boolean).join(' ').toLowerCase()
}

/** CAN-00042 — a candidate ID a recruiter can read out on a call. */
export function candidateReference(c) {
  return c?.reference ?? (c?._id ? `CAN-${c._id.slice(-5).toUpperCase()}` : '—')
}

/** The skill to show first: the recruiter's pick, else the first one parsed. */
export function primarySkillOf(c) {
  return c?.primary_skill ?? c?.parsed?.skills?.[0] ?? null
}

export function getCandidate(id) {
  const c = db.findOne('candidates', id)
  if (!c) return null
  // Follow a merge so an old link still lands on the surviving record.
  return c.merged_into ? getCandidate(c.merged_into) : c
}

export function allSkills() {
  const counts = new Map()
  for (const c of listCandidates()) {
    for (const s of c.parsed?.skills ?? []) counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([skill, count]) => ({ skill, count }))
}

/**
 * Identity resolution (§13.5), ordered by confidence. Stops at the first tier
 * that matches.
 *
 * Tier 4 is deliberately NOT automatic: two people named "Rahul Sharma" who
 * both worked at TCS is not a rare event in this market, and a wrong merge is
 * far more expensive than a duplicate row.
 */
export function resolveIdentity({ email, phone, resume_text_hash, full_name }) {
  const pool = db.all('candidates').filter((c) => !c.merged_into)

  if (email) {
    const hit = pool.find((c) => c.email === email || (c.alt_emails ?? []).includes(email))
    if (hit) return { tier: 1, action: 'merge', candidate: hit, signal: 'email' }
  }
  if (phone) {
    const hit = pool.find((c) => c.phone === phone || (c.alt_phones ?? []).includes(phone))
    if (hit) return { tier: 2, action: 'merge', candidate: hit, signal: 'phone' }
  }
  if (resume_text_hash) {
    const hit = pool.find((c) => c.resume_text_hash === resume_text_hash)
    if (hit) return { tier: 3, action: 'merge', candidate: hit, signal: 'identical resume' }
  }
  if (full_name) {
    const hit = pool.find((c) => jaroWinkler(c.full_name ?? '', full_name) > 0.92)
    if (hit) return { tier: 4, action: 'review', candidate: hit, signal: 'similar name' }
  }
  return { tier: 5, action: 'create', candidate: null, signal: null }
}

/**
 * `opts` is either `{ source }` or the source itself (`{ channel, by, … }`);
 * callers use both shapes, and treating one as "no source" silently filed
 * every uploaded resume as "Added manually".
 */
export function createCandidate(input, opts = {}) {
  const source = opts.source ?? (opts.channel ? opts : null)
  const email = normalizeEmail(input.email)
  const phone = normalizePhone(input.phone)

  const seq = db.nextSeq('candidate_seq')
  const doc = db.insert('candidates', {
    _id: newId(),
    reference: `CAN-${String(seq).padStart(5, '0')}`,
    full_name: input.full_name?.trim() || 'Unnamed candidate',
    email,
    phone,
    alt_emails: [],
    alt_phones: [],
    location: input.location ?? { state: null, city: null },
    primary_skill: input.primary_skill ?? null,
    preferred_locations: input.preferred_locations ?? [],
    flag: null,
    current: input.current ?? { title: null, company: null },
    total_experience_years: numOrNull(input.total_experience_years),
    notice_period_days: numOrNull(input.notice_period_days),
    current_ctc_lpa: numOrNull(input.current_ctc_lpa),
    expected_ctc_lpa: numOrNull(input.expected_ctc_lpa),
    parsed: input.parsed ?? { skills: [], languages: [], links: {}, confidence: 0 },
    resume_text: input.resume_text ?? null,
    resume_text_hash: input.resume_text_hash ?? null,
    resume_history: input.resume_history ?? [],
    source: source ?? { channel: 'manual_entry', by: currentUser()?.username ?? 'system' },
    tags: input.tags ?? [],
    consent: { interview_recording: null, data_processing: 'implied_by_application', captured_at: null },
    review_flag: input.review_flag ?? null,
    merged_into: null,
    created_by: currentUser()?.username ?? 'system',
    created_at: nowIso(),
    updated_at: nowIso(),
  })

  logActivity({
    type: 'candidate.created',
    subject_type: 'candidate',
    subject_id: doc._id,
    summary: `Added ${doc.full_name}`,
  })
  return doc
}

/**
 * A recruiter's own edit is written TOP-LEVEL and a re-parse never overwrites
 * it. `parsed.*` is machine territory; the top level is resolved truth (§9.4).
 */
export function updateCandidate(id, patch) {
  const { parsed: _parsed, _id, created_at: _created, skills, ...clean } = patch
  // Skills are the one list a recruiter edits in place.
  if (skills) {
    const current = db.findOne('candidates', id)
    clean.parsed = { ...(current.parsed ?? {}), skills: [...new Set(skills)] }
  }
  const doc = db.update('candidates', id, clean)
  // Names are denormalised onto applications for list rendering; a rename fans
  // out here rather than through a background job.
  if (clean.full_name || clean.email) {
    for (const app of db.find('applications', { candidate_id: id })) {
      db.update('applications', app._id, {
        candidate_name: doc.full_name,
        candidate_email: doc.email,
      })
    }
  }
  logActivity({
    type: 'candidate.updated',
    subject_type: 'candidate',
    subject_id: id,
    summary: `Updated ${doc.full_name}`,
  })
  return doc
}

/**
 * The ingest pipeline: store → extract → parse → resolve identity.
 *
 * Returns what happened rather than just the record, because the upload screen
 * has to tell the recruiter which rows were merges and which were new.
 */
export async function ingestResume({ filename, text, source, extra }) {
  const hash = await textHash(text)
  const parsed = parseResume(text)

  const identity = resolveIdentity({
    email: parsed.email,
    phone: parsed.phone,
    resume_text_hash: hash,
    full_name: parsed.name,
  })

  const version = {
    filename: filename ?? 'pasted-resume.txt',
    uploaded_at: nowIso(),
    uploaded_by: currentUser()?.username ?? 'system',
    hash,
  }

  if (identity.action === 'merge') {
    const existing = identity.candidate
    // "Which person is this?" and "is this the same file?" are different
    // questions, and the tier ladder only answers the first. Matching on email
    // (tier 1) stops before the hash is ever compared, so an identical re-upload
    // would otherwise be filed as a new resume version. Compare the hash here
    // regardless of which tier identified them.
    const isSameFile = identity.tier === 3 || existing.resume_text_hash === hash
    const patch = isSameFile
      ? {}
      : {
          resume_text: text,
          resume_text_hash: hash,
          resume_history: [...(existing.resume_history ?? []), version],
          // Machine territory refreshes; anything the recruiter typed stays.
          parsed: parsed.parsed,
        }
    // A resume from somewhere new (the extension, the career portal) fills
    // gaps — a missing LinkedIn URL, a missing city — and never overwrites.
    const fill = {}
    const pf = extra?.profile
    if (!existing.location?.city && (pf?.location?.city || parsed.location?.city)) fill.location = pf?.location?.city ? pf.location : parsed.location
    if (pf) {
      if (existing.total_experience_years == null && pf.total_experience_years != null) fill.total_experience_years = pf.total_experience_years
      if (existing.current_ctc_lpa == null && pf.current_ctc_lpa != null) fill.current_ctc_lpa = pf.current_ctc_lpa
      if (!existing.current?.title && pf.current?.title) fill.current = pf.current
      if (pf.skills?.length) {
        const base = patch.parsed ?? existing.parsed ?? {}
        fill.parsed = { ...base, skills: [...new Set([...(base.skills ?? []), ...pf.skills])] }
      }
    }
    if (extra?.links && !Object.keys(extra.links).every((k) => existing.parsed?.links?.[k])) {
      const base = fill.parsed ?? patch.parsed ?? existing.parsed
      fill.parsed = { ...base, links: { ...(existing.parsed?.links ?? {}), ...extra.links } }
    }
    const merged = { ...patch, ...fill }
    const doc = Object.keys(merged).length ? db.update('candidates', existing._id, merged) : existing

    logActivity({
      type: 'candidate.resume_added',
      subject_type: 'candidate',
      subject_id: doc._id,
      summary: isSameFile
        ? `Identical resume re-uploaded for ${doc.full_name} — ignored`
        : `New resume version for ${doc.full_name} (matched on ${identity.signal})`,
    })
    return { outcome: isSameFile ? 'duplicate' : 'merged', candidate: doc, identity, parsed }
  }

  // A portal card's labelled fields are more reliable than the resume
  // heuristics, so they win where both found something.
  const pf = extra?.profile
  const candidate = createCandidate(
    {
      full_name: extra?.full_name || pf?.name || parsed.name,
      email: parsed.email,
      phone: parsed.phone,
      location: pf?.location?.city ? pf.location : parsed.location,
      current: pf?.current?.title ? pf.current : parsed.current,
      total_experience_years: pf?.total_experience_years ?? parsed.total_experience_years,
      notice_period_days: parsed.notice_period_days,
      current_ctc_lpa: pf?.current_ctc_lpa ?? parsed.current_ctc_lpa,
      expected_ctc_lpa: parsed.expected_ctc_lpa,
      primary_skill: pf?.primary_skill ?? null,
      preferred_locations: pf?.preferred_locations ?? [],
      parsed: {
        ...parsed.parsed,
        skills: [...new Set([...(pf?.skills ?? []), ...parsed.parsed.skills])],
        links: { ...parsed.parsed.links, ...(extra?.links ?? {}) },
        education: pf?.education ? [pf.education] : parsed.parsed.education,
        employment: pf ? [pf.current, pf.previous].filter((r) => r?.title) : parsed.parsed.employment,
      },
      resume_text: text,
      resume_text_hash: hash,
      resume_history: [version],
      // Tier 4 creates the record but flags it. Never auto-merge on a name.
      review_flag:
        identity.action === 'review'
          ? { reason: `Similar name to ${identity.candidate.full_name}`, other_id: identity.candidate._id }
          : null,
    },
    source ?? { channel: 'resume_upload', detail: filename, by: currentUser()?.username ?? 'system' },
  )

  return {
    outcome: identity.action === 'review' ? 'flagged' : 'created',
    candidate,
    identity,
    parsed,
  }
}

/** Non-destructive merge: the loser stays, pointing at the winner. */
export function mergeCandidates(loserId, winnerId) {
  const loser = db.findOne('candidates', loserId)
  const winner = db.findOne('candidates', winnerId)
  if (!loser || !winner) throw new Error('Both candidates must exist.')
  if (loserId === winnerId) throw new Error('Cannot merge a candidate into themselves.')

  db.update('candidates', winnerId, {
    alt_emails: [...new Set([...(winner.alt_emails ?? []), loser.email].filter(Boolean))],
    alt_phones: [...new Set([...(winner.alt_phones ?? []), loser.phone].filter(Boolean))],
    resume_history: [...(winner.resume_history ?? []), ...(loser.resume_history ?? [])],
    parsed: {
      ...winner.parsed,
      skills: [...new Set([...(winner.parsed?.skills ?? []), ...(loser.parsed?.skills ?? [])])],
    },
  })

  // Re-point applications. If that would duplicate (candidate, job), keep the
  // most-advanced one and concatenate the histories.
  for (const app of db.find('applications', { candidate_id: loserId })) {
    const clash = db.findOne('applications', { candidate_id: winnerId, job_id: app.job_id })
    if (clash) {
      db.update('applications', clash._id, {
        stage_history: [...clash.stage_history, ...app.stage_history].sort((a, b) => a.at.localeCompare(b.at)),
        notes: [...(clash.notes ?? []), ...(app.notes ?? [])],
      })
      db.remove('applications', app._id)
    } else {
      db.update('applications', app._id, {
        candidate_id: winnerId,
        candidate_name: winner.full_name,
        candidate_email: winner.email,
      })
    }
  }

  db.update('candidates', loserId, { merged_into: winnerId, review_flag: null })
  db.update('candidates', winnerId, { review_flag: null })

  logActivity({
    type: 'candidate.merged',
    subject_type: 'candidate',
    subject_id: winnerId,
    summary: `Merged ${loser.full_name} into ${winner.full_name}`,
    meta: { loser_id: loserId },
  })
  return getCandidate(winnerId)
}

export function dismissReviewFlag(id) {
  return db.update('candidates', id, { review_flag: null })
}

/** A recruiter's red flag — "fake experience", "did not turn up". Visible everywhere they appear. */
export function setCandidateFlag(id, reason) {
  const flag = reason?.trim()
    ? { reason: reason.trim(), by: currentUser()?.username ?? 'system', at: nowIso() }
    : null
  const doc = db.update('candidates', id, { flag })
  logActivity({
    type: flag ? 'candidate.flagged' : 'candidate.unflagged',
    subject_type: 'candidate',
    subject_id: id,
    summary: flag ? `Flagged ${doc.full_name}: ${flag.reason}` : `Removed flag from ${doc.full_name}`,
  })
  return doc
}

export function setCandidateTags(id, tags) {
  const clean = [...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))]
  return db.update('candidates', id, { tags: clean })
}

export function allTags() {
  return [...new Set(listCandidates().flatMap((c) => c.tags ?? []))].sort()
}

/**
 * Delete a candidate and everything hanging off them — applications, sessions,
 * reports. This is the DPDP "erase my data" path, so it is total by design.
 */
export function deleteCandidate(id) {
  const c = db.findOne('candidates', id)
  if (!c) return false
  for (const app of db.find('applications', { candidate_id: id })) db.remove('applications', app._id)
  for (const s of db.find('interview_sessions', { candidate_id: id })) db.remove('interview_sessions', s._id)
  for (const r of db.find('interview_reports', { candidate_id: id })) db.remove('interview_reports', r._id)
  db.remove('candidates', id)
  logActivity({ type: 'candidate.deleted', subject_type: 'candidate', subject_id: id, summary: `Deleted ${c.full_name} and all their data` })
  return true
}

// --- DPDP consent -------------------------------------------------------------

export function requestConsent(id) {
  const c = getCandidate(id)
  const token = newId()
  db.update('candidates', c._id, {
    consent: { ...(c.consent ?? {}), data_processing: 'requested', token, requested_at: nowIso() },
  })
  logActivity({ type: 'candidate.consent_requested', subject_type: 'candidate', subject_id: c._id, summary: `Consent requested from ${c.full_name}` })
  return { token, url: `${location.origin}/consent/${token}` }
}

export function findByConsentToken(token) {
  return db.all('candidates').find((c) => c.consent?.token === token) ?? null
}

export function recordConsentResponse(token, granted) {
  const c = findByConsentToken(token)
  if (!c) throw new Error('This link is not valid.')
  const doc = db.update('candidates', c._id, {
    consent: { ...c.consent, data_processing: granted ? 'granted' : 'refused', captured_at: nowIso() },
  })
  logActivity({
    type: 'candidate.consent_response', subject_type: 'candidate', subject_id: c._id,
    summary: `${c.full_name} ${granted ? 'granted' : 'refused'} data consent`, by: 'candidate',
  })
  return doc
}

/** The resume as a downloadable text file. */
export function resumeFile(c) {
  const name = (c.full_name ?? 'candidate').replace(/[^\w]+/g, '_')
  const text = c.resume_text ?? [
    c.full_name, c.email, c.phone,
    c.current?.title && `${c.current.title}${c.current.company ? ` at ${c.current.company}` : ''}`,
    c.total_experience_years != null && `Total experience: ${c.total_experience_years} years`,
    (c.parsed?.skills ?? []).length && `Skills: ${c.parsed.skills.join(', ')}`,
  ].filter(Boolean).join('\n')
  return { filename: `${candidateReference(c)}_${name}.txt`, text }
}

const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))

// --- Jaro-Winkler, for tier-4 name similarity ------------------------------

function jaroWinkler(a, b) {
  a = a.toLowerCase().trim()
  b = b.toLowerCase().trim()
  if (!a || !b) return 0
  if (a === b) return 1

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatched = new Array(a.length).fill(false)
  const bMatched = new Array(b.length).fill(false)
  let matches = 0

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window)
    const end = Math.min(i + window + 1, b.length)
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue
      aMatched[i] = true
      bMatched[j] = true
      matches++
      break
    }
  }
  if (!matches) return 0

  let transpositions = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue
    while (!bMatched[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  transpositions /= 2

  const jaro = (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3

  let prefix = 0
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++

  return jaro + prefix * 0.1 * (1 - jaro)
}
