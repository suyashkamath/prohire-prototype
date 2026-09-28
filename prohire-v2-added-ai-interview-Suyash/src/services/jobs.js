// Jobs (§9.3). The job is the spine — nothing in the flow can start without one.

import { db } from '../lib/db.js'
import { newId, nowIso } from '../lib/ids.js'
import { getSettings, currentUser, logActivity } from './core.js'
import { getDepartment } from './departments.js'

/**
 * `{DEPT_CODE}-{SEQ:04d}` — IT-0022, SLS-0104.
 *
 * A recruiter reads this aloud on a phone call; a 24-character hex id cannot be
 * read aloud. The counter is incremented atomically (§9.3.2) — in a browser
 * that is genuinely atomic, since a tab is single-threaded.
 */
export function nextReference(departmentCode) {
  const seq = db.nextSeq(`job_seq:${departmentCode}`)
  return { reference: `${departmentCode}-${String(seq).padStart(4, '0')}`, seq }
}

export function listJobs({ status, department_id, q, owner } = {}) {
  let rows = db.all('jobs')
  if (status) rows = rows.filter((j) => j.status === status)
  if (department_id) rows = rows.filter((j) => j.department_id === department_id)
  if (owner) rows = rows.filter((j) => j.owner_username === owner)
  if (q) {
    const n = q.toLowerCase()
    rows = rows.filter(
      (j) =>
        j.title.toLowerCase().includes(n) ||
        j.reference.toLowerCase().includes(n) ||
        (j.skills_required ?? []).some((s) => s.toLowerCase().includes(n)),
    )
  }
  return rows.map(withStats).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getJob(id) {
  const j = db.findOne('jobs', id)
  return j ? withStats(j) : null
}

export function getJobByReference(reference) {
  const j = db.findOne('jobs', { reference })
  return j ? withStats(j) : null
}

/** Live counts rather than a denormalised cache — correct by construction here. */
function withStats(job) {
  const apps = db.find('applications', { job_id: job._id })
  return {
    ...job,
    stats: {
      applicants: apps.length,
      screened: apps.filter((a) => a.screening).length,
      interviewed: apps.filter((a) => a.interview_summary?.state === 'completed').length,
      shortlisted: apps.filter((a) => a.stage === 'shortlisted' || a.stage === 'human_round' || a.stage === 'selected').length,
    },
  }
}

export function createJob(input) {
  const dept = getDepartment(input.department_id)
  if (!dept) throw new Error('Pick a department. A job cannot exist without one.')
  if (!input.title?.trim()) throw new Error('Job title is required.')
  if (!input.description?.trim() || input.description.trim().length < 40) {
    throw new Error('The job description feeds both screening and the interview. Write at least a few lines.')
  }

  const { reference, seq } = nextReference(dept.code)
  const settings = getSettings()

  const doc = db.insert('jobs', {
    _id: newId(),
    reference,
    seq,
    title: input.title.trim(),
    department_id: dept._id,
    department_name: dept.name,

    // One description, two consumers: the screening engine scores against it
    // and the interviewer is briefed with it. Keeping one source is what stops
    // a recruiter screening for one role and interviewing for another.
    description: input.description.trim(),
    responsibilities: input.responsibilities ?? [],
    skills_required: dedupe(input.skills_required),
    skills_preferred: dedupe(input.skills_preferred),

    experience: {
      min_years: Number(input.experience?.min_years) || 0,
      max_years: Number(input.experience?.max_years) || 0,
      level: input.experience?.level ?? 'Experienced',
    },
    compensation: {
      min_lpa: numOrNull(input.compensation?.min_lpa),
      max_lpa: numOrNull(input.compensation?.max_lpa),
      currency: 'INR',
      disclosed: Boolean(input.compensation?.disclosed),
    },
    employment_type: input.employment_type ?? 'Full-time',
    location: {
      state: input.location?.state ?? dept.location.state,
      city: input.location?.city ?? dept.location.city,
      mode: input.location?.mode ?? 'On-site',
    },
    openings: Number(input.openings) || 1,

    // The skill the interview leans on hardest, and how much of it the role needs.
    primary_skill: input.primary_skill?.trim() || null,
    primary_skill_min_years: numOrNull(input.primary_skill_min_years),

    status: input.status === 'draft' ? 'draft' : 'active',
    // Where the job is advertised. The career portal is ours and instant;
    // LinkedIn needs the integration and is recorded as intent for now.
    publish: {
      career_portal: Boolean(input.publish?.career_portal),
      linkedin: Boolean(input.publish?.linkedin),
      published_at: input.publish?.career_portal ? nowIso() : null,
    },
    owner_username: currentUser()?.username ?? 'system',

    interview_template_id: null,
    interview_languages: input.interview_languages ?? ['en-IN', 'hi-IN'],
    interview_language_default: input.interview_language_default ?? 'en-IN',

    screening_profile: {
      hiring_type: input.screening_profile?.hiring_type ?? 'IT',
      level: input.experience?.level ?? 'Experienced',
      // Per-job override, so a hard-to-fill role can relax the bar without a
      // global config change.
      match_threshold:
        numOrNull(input.screening_profile?.match_threshold) ?? settings.match_threshold,
    },

    created_by: currentUser()?.username ?? 'system',
    created_at: nowIso(),
    updated_at: nowIso(),
    closed_at: null,
  })

  logActivity({
    type: 'job.created',
    subject_type: 'job',
    subject_id: doc._id,
    summary: `Created ${doc.reference} · ${doc.title}`,
  })
  return doc
}

export function updateJob(id, patch) {
  // `reference` and `seq` are not updatable, for the same reason a department
  // code is not.
  const { reference: _ref, seq: _seq, _id, created_at: _created, ...clean } = patch
  const doc = db.update('jobs', id, clean)
  logActivity({
    type: 'job.updated',
    subject_type: 'job',
    subject_id: id,
    summary: `Updated ${doc.reference}`,
  })
  return doc
}

/**
 * Normalise a form's worth of edits the same way `createJob` does, so an edit
 * cannot save a shape a create would have refused.
 */
export function editJob(id, input) {
  const job = getJob(id)
  if (!input.title?.trim()) throw new Error('Job title is required.')
  if (!input.description?.trim() || input.description.trim().length < 40) {
    throw new Error('The job description feeds both screening and the interview. Write at least a few lines.')
  }
  // Changing department would change the reference, which people have already
  // read aloud on calls. The department name follows; the reference does not.
  const dept = input.department_id ? getDepartment(input.department_id) : null
  return updateJob(id, {
    title: input.title.trim(),
    department_id: dept?._id ?? job.department_id,
    department_name: dept?.name ?? job.department_name,
    description: input.description.trim(),
    skills_required: dedupe(input.skills_required),
    skills_preferred: dedupe(input.skills_preferred),
    primary_skill: input.primary_skill?.trim() || null,
    primary_skill_min_years: numOrNull(input.primary_skill_min_years),
    experience: {
      min_years: Number(input.experience?.min_years) || 0,
      max_years: Number(input.experience?.max_years) || 0,
      level: input.experience?.level ?? job.experience.level,
    },
    compensation: {
      min_lpa: numOrNull(input.compensation?.min_lpa),
      max_lpa: numOrNull(input.compensation?.max_lpa),
      currency: 'INR',
      disclosed: Boolean(input.compensation?.disclosed),
    },
    employment_type: input.employment_type ?? job.employment_type,
    location: {
      state: input.location?.state || job.location.state,
      city: input.location?.city || job.location.city,
      mode: input.location?.mode ?? job.location.mode,
    },
    openings: Number(input.openings) || 1,
    interview_language_default: input.interview_language_default ?? job.interview_language_default,
    screening_profile: {
      ...job.screening_profile,
      hiring_type: input.screening_profile?.hiring_type ?? job.screening_profile.hiring_type,
      match_threshold: numOrNull(input.screening_profile?.match_threshold) ?? job.screening_profile.match_threshold,
    },
  })
}

export function setPublished(id, channel, on) {
  const job = getJob(id)
  const publish = { career_portal: false, linkedin: false, published_at: null, ...(job.publish ?? {}), [channel]: Boolean(on) }
  if (channel === 'career_portal') publish.published_at = on ? nowIso() : null
  const doc = db.update('jobs', id, { publish })
  logActivity({
    type: 'job.published',
    subject_type: 'job',
    subject_id: id,
    summary: `${doc.reference} ${on ? 'published on' : 'removed from'} ${channel === 'career_portal' ? 'the career portal' : 'LinkedIn'}`,
  })
  return doc
}

/**
 * The job feed for the official career page: active jobs marked for it.
 * The real system serves this as GET /api/v1/career-portal/jobs.
 */
export function listPublicJobs() {
  return db.all('jobs')
    .filter((j) => j.status === 'active' && j.publish?.career_portal)
    .sort((a, b) => (b.publish.published_at ?? '').localeCompare(a.publish.published_at ?? ''))
}

export function setJobStatus(id, status) {
  const doc = db.update('jobs', id, {
    status,
    closed_at: status === 'closed' || status === 'cancelled' ? nowIso() : null,
  })
  logActivity({
    type: 'job.status',
    subject_type: 'job',
    subject_id: id,
    summary: `${doc.reference} → ${status}`,
  })
  return doc
}

const dedupe = (arr) => [...new Set((arr ?? []).map((s) => s.trim()).filter(Boolean))]
const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
