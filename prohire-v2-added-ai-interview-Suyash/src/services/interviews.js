// The interview engine (§10, §11) — templates, the resolve-and-freeze step,
// conducting a session, and producing a report.
//
// The one property to keep in mind while reading this file: once `invite()`
// returns, the session's plan is IMMUTABLE. Everything downstream — conduct,
// scoring, the report — reads `session.plan` and never the live job or
// template. That is why editing a job tomorrow cannot change a report from
// today, and why a report still renders after its job is deleted.

import { db } from '../lib/db.js'
import { newId, newToken, nowIso } from '../lib/ids.js'
import { resolvePlan, freeze, validatePlan, ORG_DEFAULT_RULES, DEFAULT_PERSONA_NAME } from '../domain/resolvePlan.js'
import { generateQuestions, nextFollowUp, scoreSession } from '../domain/ai.js'
import { currentUser, logActivity, getSettings } from './core.js'
import { getJob } from './jobs.js'
import { getCandidate } from './candidates.js'
import { getApplication, systemMoveStage, moveStage } from './applications.js'
import { evaluateQualification, defaultQualification } from '../domain/qualification.js'
import { languageByCode } from '../domain/locations.js'
import { DEFAULT_REALTIME_VOICE } from '../domain/interviewerPrompt.js'

// --- templates (§9.6) ------------------------------------------------------

export function listTemplates({ scope, scope_id } = {}) {
  let rows = db.all('interview_templates')
  if (scope) rows = rows.filter((t) => t.scope === scope)
  if (scope_id !== undefined) rows = rows.filter((t) => t.scope_id === scope_id)
  return rows
}

export function getTemplate(id) {
  return id ? db.findOne('interview_templates', id) : null
}

export function orgTemplate() {
  let t = db.findOne('interview_templates', { scope: 'org' })
  if (!t) {
    // The org default always exists — that is what makes configuration optional
    // rather than required (§11.4).
    t = db.insert('interview_templates', {
      _id: newId(),
      name: 'Organisation default',
      scope: 'org',
      scope_id: null,
      persona: { name: getSettings().persona_name ?? DEFAULT_PERSONA_NAME },
      rules: { ...ORG_DEFAULT_RULES },
      questions: [],
      scoring: {},
      auto_generate_questions: true,
      version: 1,
      created_by: 'system',
      created_at: nowIso(),
      updated_at: nowIso(),
    })
  }
  if (['Erika', 'Erica'].includes(t.persona?.name)) {
    t = db.update('interview_templates', t._id, { persona: { ...t.persona, name: getSettings().persona_name } })
  }
  return t
}

export function saveTemplate(input) {
  if (input._id) {
    const doc = db.update('interview_templates', input._id, {
      ...input,
      version: (getTemplate(input._id)?.version ?? 1) + 1,
    })
    logActivity({
      type: 'template.updated',
      subject_type: 'template',
      subject_id: doc._id,
      summary: `Updated interview template "${doc.name}" (v${doc.version})`,
    })
    return doc
  }
  const doc = db.insert('interview_templates', {
    _id: newId(),
    name: input.name ?? 'Untitled template',
    scope: input.scope ?? 'job',
    scope_id: input.scope_id ?? null,
    persona: input.persona ?? {},
    rules: input.rules ?? {},
    questions: input.questions ?? [],
    qualification: input.qualification ?? [],
    scoring: input.scoring ?? {},
    auto_generate_questions: input.auto_generate_questions ?? true,
    version: 1,
    created_by: currentUser()?.username ?? 'system',
    created_at: nowIso(),
    updated_at: nowIso(),
  })
  logActivity({
    type: 'template.created',
    subject_type: 'template',
    subject_id: doc._id,
    summary: `Created interview template "${doc.name}"`,
  })
  return doc
}

/**
 * How many already-invited sessions an edit to this template would affect.
 * Feeds the §11.6 save dialog — the recruiter is told before they save, not
 * after.
 */
export function affectedInvitedCount(templateId) {
  return db
    .find('interview_sessions', { state: 'invited' })
    .filter((s) =>
      Object.values(s.plan?.resolved_from ?? {}).includes(templateId),
    ).length
}

// --- the resolution chain (§11.3) ------------------------------------------

/**
 * Build the layer stack for one application and flatten it.
 *
 * Pure with respect to the database in the sense that matters: it reads, but it
 * writes nothing and has no side effects, so the Interview Setup screen can
 * call it on every keystroke to show a live preview with provenance.
 */
export function resolveForApplication(applicationId, adhoc = null) {
  const app = getApplication(applicationId)
  const job = getJob(app.job_id)
  const candidate = getCandidate(app.candidate_id)

  const org = orgTemplate()
  const dept = listTemplates({ scope: 'department', scope_id: job.department_id })[0] ?? null
  const jobTpl = job.interview_template_id
    ? getTemplate(job.interview_template_id)
    : listTemplates({ scope: 'job', scope_id: job._id })[0] ?? null

  const layers = [
    { source: 'org default', ...org },
    dept && { source: `department: ${job.department_name}`, ...dept },
    jobTpl && { source: `job: ${job.reference}`, ...jobTpl },
    // The job's own language default is a layer, not a special case.
    job.interview_language_default && {
      source: `job: ${job.reference}`,
      rules: { language: job.interview_language_default },
    },
    app.interview_override && { source: 'this candidate', ...app.interview_override },
    adhoc && { source: 'this invite', ...adhoc },
  ].filter(Boolean)

  const plan = resolvePlan(layers, { job, candidate })

  return {
    plan,
    problems: validatePlan(plan),
    resolved_from: {
      org_template_id: org._id,
      dept_template_id: dept?._id ?? null,
      job_template_id: jobTpl?._id ?? null,
      candidate_override: Boolean(app.interview_override),
      adhoc: Boolean(adhoc),
    },
    job,
    candidate,
    application: app,
  }
}

/**
 * Generate-then-edit beats configure-from-scratch (§11.4).
 *
 * The recruiter never had to configure anything, and ends up with an editable,
 * job-specific template they did not have to write. Persisted on first use so
 * the second candidate on that job gets the SAME interview — comparability is
 * the reason.
 */
export async function ensureJobQuestions(jobId, candidateId) {
  const job = getJob(jobId)
  const existing = job.interview_template_id
    ? getTemplate(job.interview_template_id)
    : listTemplates({ scope: 'job', scope_id: jobId })[0]

  if (existing?.questions?.length) return existing

  const candidate = candidateId ? getCandidate(candidateId) : null
  const questions = await generateQuestions({ job, candidate, count: ORG_DEFAULT_RULES.max_questions })

  const tpl = saveTemplate({
    _id: existing?._id,
    name: `${job.reference} · ${job.title}`,
    scope: 'job',
    scope_id: jobId,
    questions,
    rules: existing?.rules ?? {},
    qualification: existing?.qualification ?? [],
    auto_generate_questions: true,
  })

  db.update('jobs', jobId, { interview_template_id: tpl._id })
  logActivity({
    type: 'template.generated',
    subject_type: 'job',
    subject_id: jobId,
    summary: `Generated ${questions.length} interview questions for ${job.reference}`,
    by: 'system',
  })
  return tpl
}

/**
 * The questionnaire gets the same generate-then-edit treatment: a job that
 * has none gets the standard set (CTC, notice, location, primary-skill years)
 * the first time anyone needs it.
 */
export function ensureQualification(jobId) {
  const job = getJob(jobId)
  const tpl = job.interview_template_id
    ? getTemplate(job.interview_template_id)
    : listTemplates({ scope: 'job', scope_id: jobId })[0]
  if (tpl?.qualification?.length) return tpl
  const doc = saveTemplate({
    ...(tpl ?? {}),
    _id: tpl?._id,
    name: tpl?.name ?? `${job.reference} · ${job.title}`,
    scope: 'job',
    scope_id: jobId,
    questions: tpl?.questions ?? [],
    rules: tpl?.rules ?? {},
    qualification: defaultQualification(job),
  })
  if (!job.interview_template_id) db.update('jobs', jobId, { interview_template_id: doc._id })
  return doc
}

export function setCandidateOverride(applicationId, override) {
  db.update('applications', applicationId, { interview_override: override })
  return getApplication(applicationId)
}

export function clearCandidateOverride(applicationId) {
  db.update('applications', applicationId, { interview_override: null })
  return getApplication(applicationId)
}

// --- ❄ the freeze (§11.5) --------------------------------------------------

/**
 * Issue an invite. This is the moment the plan stops being a query and becomes
 * a fact.
 */
export async function invite(applicationId, adhoc = null, { email } = {}) {
  const app = getApplication(applicationId)
  await ensureJobQuestions(app.job_id, app.candidate_id)

  const resolved = resolveForApplication(applicationId, adhoc)
  if (resolved.problems.length) {
    // Fail in front of the recruiter, not in front of the candidate (§12.5).
    throw new Error(resolved.problems.join(' '))
  }

  if (!app.candidate_email) {
    // Not fatal — the link can be sent over WhatsApp — but worth saying.
    logActivity({ type: 'interview.no_email', subject_type: 'application', subject_id: applicationId, summary: `${app.candidate_name} has no email — share the link another way` })
  }

  const attempt = db.find('interview_sessions', { application_id: applicationId }).length + 1
  const token = newToken()
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString()

  const session = db.insert('interview_sessions', {
    _id: newId(),
    application_id: applicationId,
    candidate_id: app.candidate_id,
    job_id: app.job_id,
    attempt,

    // FROZEN. Never mutated once state leaves "invited". The live
    // interviewer's voice is frozen with it, like the name.
    plan: freeze(
      { ...resolved.plan, persona: { ...resolved.plan.persona, realtime_voice: getSettings().interviewer_voice ?? DEFAULT_REALTIME_VOICE } },
      resolved.resolved_from,
    ),

    invite: {
      // The real system stores only sha256(token) and mails the raw value.
      // There is no server here to keep a secret from, so the token is stored
      // as-is — noted rather than faked.
      token,
      issued_at: nowIso(),
      expires_at: expiresAt,
      opened_at: null,
      sent_to: app.candidate_email,
      // What the recruiter actually sent, after their last edit in the
      // compose box. "What did we tell her?" is answerable later.
      email: email ?? null,
      resend_count: 0,
    },

    state: 'invited',
    consent: { recording: null, captured_at: null },
    turns: [],
    cursor: { question_index: 0, follow_ups_asked: 0 },
    integrity: { tab_switches: 0, long_silences: 0, paste_events: 0, face_missing: 0, multiple_faces: 0, fullscreen_exits: 0 },
    violations: [],
    qualification_answers: null,
    recording: null,
    started_at: null,
    ended_at: null,
    duration_seconds: null,
    end_reason: null,
    report_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  })

  moveStage(applicationId, 'invited', `Interview invite sent (attempt ${attempt})`)
  db.update('applications', applicationId, {
    interview_summary: { session_id: session._id, state: 'invited', attempts: attempt },
  })

  logActivity({
    type: 'interview.invited',
    subject_type: 'application',
    subject_id: applicationId,
    summary: `Invited ${app.candidate_name} — ${resolved.plan.questions.length} questions, ${resolved.plan.rules.duration_minutes} min, ${resolved.plan.rules.language}`,
  })

  return { session, url: interviewUrl(token) }
}

export const interviewUrl = (token) => `${location.origin}/interview/${token}`
export const reportUrl = (token) => `${location.origin}/share-report/${token}`

// --- sessions --------------------------------------------------------------

export function listSessions({ state, job_id } = {}) {
  let rows = db.all('interview_sessions')
  if (state) rows = rows.filter((s) => (Array.isArray(state) ? state.includes(s.state) : s.state === state))
  if (job_id) rows = rows.filter((s) => s.job_id === job_id)
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getSession(id) {
  return db.findOne('interview_sessions', id)
}

export function sessionsFor(applicationId) {
  return db
    .find('interview_sessions', { application_id: applicationId })
    .sort((a, b) => b.attempt - a.attempt)
}

export function findByToken(token) {
  return db.all('interview_sessions').find((s) => s.invite?.token === token) ?? null
}

export function cancelSession(id) {
  const s = getSession(id)
  db.update('interview_sessions', id, { state: 'cancelled' })
  logActivity({
    type: 'interview.cancelled',
    subject_type: 'application',
    subject_id: s.application_id,
    summary: 'Interview invite cancelled',
  })
  return getSession(id)
}

export function resendInvite(id) {
  const s = getSession(id)
  db.update('interview_sessions', id, {
    invite: {
      ...s.invite,
      resend_count: (s.invite.resend_count ?? 0) + 1,
      expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    },
  })
  return { session: getSession(id), url: interviewUrl(s.invite.token) }
}

/**
 * Expire what is past its date.
 *
 * Note the verb: expire, not delete. An expired invite must stay visible —
 * "she never started it" is information a recruiter needs (§9.7).
 */
export function sweepExpired() {
  const now = Date.now()
  let n = 0
  for (const s of db.find('interview_sessions', { state: 'invited' })) {
    if (new Date(s.invite.expires_at).getTime() < now) {
      db.update('interview_sessions', s._id, { state: 'expired' })
      n++
    }
  }
  // A session that was started and abandoned mid-way becomes `abandoned` after
  // 30 minutes of silence. Whatever was answered still gets scored.
  for (const s of db.find('interview_sessions', { state: 'in_progress' })) {
    const last = s.turns.at(-1)?.at ?? s.started_at
    if (last && now - new Date(last).getTime() > 30 * 60_000) {
      db.update('interview_sessions', s._id, { state: 'abandoned', end_reason: 'timeout' })
      systemMoveStage(s.application_id, 'abandoned')
      n++
    }
  }
  return n
}

// --- conducting (§10.5) ----------------------------------------------------

/**
 * The candidate-facing bootstrap.
 *
 * Note what it does NOT return: the rubric, the weights, or the expected
 * answer points. The candidate's page never receives the marking scheme.
 */
export function bootstrap(token) {
  const s = findByToken(token)
  if (!s) return { error: 'This interview link is not valid.' }
  if (s.state === 'expired') return { error: 'This invitation has expired. Ask your recruiter for a new link.' }
  if (s.state === 'cancelled') return { error: 'This interview has been cancelled.' }
  if (s.state === 'completed') return { error: 'This interview is already complete. Thank you.' }
  if (new Date(s.invite.expires_at).getTime() < Date.now()) {
    db.update('interview_sessions', s._id, { state: 'expired' })
    return { error: 'This invitation has expired. Ask your recruiter for a new link.' }
  }

  const lang = languageByCode(s.plan.rules.language)
  const proctoring = s.plan.rules.proctoring ?? {}
  return {
    session_id: s._id,
    state: s.state,
    persona: s.plan.persona,
    language: s.plan.rules.language,
    speech_lang: lang.speech,
    duration_minutes: s.plan.rules.duration_minutes,
    mode: s.plan.rules.mode ?? 'text',
    assessment_type: s.plan.rules.assessment_type ?? 'interview',
    question_count: s.plan.questions.length,
    // The questionnaire, minus its knockout rules — the candidate sees the
    // question, never the answer that flags them.
    qualification: (s.plan.qualification ?? []).map(({ id, text, kind, options }) => ({ id, text, kind, options })),
    qualification_done: Boolean(s.qualification_answers),
    proctoring: {
      tab_switch_warning: proctoring.tab_switch_warning !== false,
      max_tab_switches: proctoring.max_tab_switches ?? 3,
      auto_terminate: proctoring.auto_terminate !== false,
      paste_detection: proctoring.paste_detection !== false,
      face_presence: Boolean(proctoring.face_presence),
    },
    tab_switches: s.integrity?.tab_switches ?? 0,
    job_title: s.plan.job_context?.title,
    company: getSettings().org_name ?? 'ProHire',
    candidate_name: s.plan.candidate_context?.full_name,
    consent: s.consent,
    // Resumability: a dropped connection returns to the same place, because
    // the state lives in storage, never in memory (§10.4).
    resume_at: s.cursor.question_index,
  }
}

export function recordConsent(token, granted) {
  const s = findByToken(token)
  if (!s) throw new Error('Invalid link.')
  db.update('interview_sessions', s._id, {
    consent: { recording: granted, captured_at: nowIso() },
  })
  return getSession(s._id)
}

export function startSession(token, device = {}) {
  const s = findByToken(token)
  if (!s) throw new Error('Invalid link.')
  if (s.state === 'invited') {
    db.update('interview_sessions', s._id, {
      state: 'in_progress',
      started_at: nowIso(),
      device,
      invite: { ...s.invite, opened_at: s.invite.opened_at ?? nowIso() },
    })
    systemMoveStage(s.application_id, 'interview_in_progress')
    db.update('applications', s.application_id, {
      interview_summary: { ...(getApplication(s.application_id).interview_summary ?? {}), state: 'in_progress' },
    })
    logActivity({
      type: 'interview.started',
      subject_type: 'application',
      subject_id: s.application_id,
      summary: `${s.plan.candidate_context?.full_name} started their interview`,
      by: 'candidate',
    })
  }
  return currentQuestion(s._id)
}

/** What to ask next — the question loop, resumable from storage alone. */
export function currentQuestion(sessionId) {
  const s = getSession(sessionId)
  const { question_index } = s.cursor
  const question = s.plan.questions[question_index] ?? null

  return {
    done: question == null,
    index: question_index,
    total: s.plan.questions.length,
    question: question && {
      id: question.id,
      // The candidate sees the text and nothing else — no competency, no
      // weight, no expected points.
      text: question.text,
      type: question.type,
    },
    follow_ups_asked: s.cursor.follow_ups_asked,
    pending_follow_up: s.cursor.pending_follow_up ?? null,
  }
}

function appendTurn(sessionId, turn) {
  const s = getSession(sessionId)
  const turns = [...s.turns, { seq: s.turns.length + 1, at: nowIso(), ...turn }]
  db.update('interview_sessions', sessionId, { turns })
  return turns
}

export function askQuestion(sessionId) {
  const s = getSession(sessionId)
  const q = s.plan.questions[s.cursor.question_index]
  if (!q) return null
  // Do not re-record the same question if the candidate reloads mid-question.
  const alreadyAsked = s.turns.some((t) => t.question_id === q.id && t.kind === 'question')
  if (!alreadyAsked) {
    appendTurn(sessionId, { role: 'interviewer', question_id: q.id, kind: 'question', text: q.text })
  }
  return q
}

/**
 * Submit an answer. Returns either a follow-up to ask, or advances the cursor.
 */
export async function submitAnswer(sessionId, text, { durationSeconds } = {}) {
  const s = getSession(sessionId)
  const q = s.plan.questions[s.cursor.question_index]
  if (!q) return { done: true }

  appendTurn(sessionId, {
    role: 'candidate',
    question_id: q.id,
    kind: s.cursor.pending_follow_up ? 'follow_up_answer' : 'answer',
    text: text.trim(),
    duration_seconds: durationSeconds ?? null,
    words: text.trim().split(/\s+/).filter(Boolean).length,
  })

  const followUp = await nextFollowUp({
    question: q,
    answer: text,
    strictness: s.plan.rules.strictness,
    alreadyAsked: s.cursor.follow_ups_asked,
  })

  if (followUp && s.cursor.follow_ups_asked < (s.plan.rules.follow_ups_per_question ?? 1)) {
    appendTurn(sessionId, { role: 'interviewer', question_id: q.id, kind: 'follow_up', text: followUp })
    db.update('interview_sessions', sessionId, {
      cursor: {
        question_index: s.cursor.question_index,
        follow_ups_asked: s.cursor.follow_ups_asked + 1,
        pending_follow_up: followUp,
      },
    })
    return { follow_up: followUp, done: false }
  }

  db.update('interview_sessions', sessionId, {
    cursor: { question_index: s.cursor.question_index + 1, follow_ups_asked: 0, pending_follow_up: null },
  })
  const next = currentQuestion(sessionId)
  return { done: next.done, next }
}

// --- live conduct (Mode A, §10.3) ------------------------------------------
//
// The live interviewer speaks and listens through OpenAI Realtime, but it
// writes the same turns and moves the same cursor as the typed flow above, so
// scoring, the report and resume do not know or care which mode ran.

/**
 * The live interviewer's `next_question` tool.
 *
 * The cursor stays the source of truth. The first call on a page (a fresh
 * start, a reload or a reconnect) passes `advance: false` and gets the question
 * at the cursor, so a question interrupted by a dropped connection is asked
 * again rather than skipped. Every later call moves past the current question.
 */
export function liveNextQuestion(sessionId, { advance = true } = {}) {
  const s = getSession(sessionId)
  if (!s || s.state !== 'in_progress') return { done: true, index: 0, total: 0, question: null }
  if (advance && s.plan.questions[s.cursor.question_index]) {
    db.update('interview_sessions', sessionId, {
      cursor: { question_index: s.cursor.question_index + 1, follow_ups_asked: 0, pending_follow_up: null },
    })
  }
  return currentQuestion(sessionId)
}

/**
 * One line of the live conversation, as heard. The kind is derived here, so it
 * matches what the typed flow writes: the first interviewer line on a question
 * is the `question`; a later one that asks something is a `follow_up`; anything
 * else the interviewer says (an acknowledgement, the greeting) is a `remark`.
 */
export function recordLiveTurn(sessionId, { role, text, questionId = null, typed = false }) {
  const s = getSession(sessionId)
  const clean = String(text ?? '').trim()
  if (!s || s.state !== 'in_progress' || !clean) return null

  const onQuestion = questionId ? s.turns.filter((t) => t.question_id === questionId) : []
  let kind
  if (role === 'interviewer') {
    if (!questionId) kind = 'remark'
    else if (!onQuestion.some((t) => t.kind === 'question')) kind = 'question'
    else kind = /[?？]/.test(clean) ? 'follow_up' : 'remark'
  } else {
    kind = onQuestion.some((t) => t.kind === 'follow_up') ? 'follow_up_answer' : 'answer'
  }

  if (kind === 'follow_up') {
    db.update('interview_sessions', sessionId, {
      cursor: { ...s.cursor, follow_ups_asked: (s.cursor.follow_ups_asked ?? 0) + 1 },
    })
  }
  const turns = appendTurn(sessionId, {
    role,
    question_id: questionId,
    kind,
    text: clean,
    source: 'live',
    ...(role === 'candidate' ? { words: clean.split(/\s+/).filter(Boolean).length } : {}),
    ...(typed ? { typed: true } : {}),
  })
  return turns.at(-1)
}

/**
 * Record an integrity event and return the new count for that kind.
 * Every event is also kept with its time, so the report can say "tab switch
 * at 04:12, during question 3" rather than just a number.
 */
export function recordIntegrityEvent(sessionId, kind, detail = null) {
  const s = getSession(sessionId)
  if (!s || s.state !== 'in_progress') return null
  const count = (s.integrity?.[kind] ?? 0) + 1
  db.update('interview_sessions', sessionId, {
    integrity: { ...s.integrity, [kind]: count },
    violations: [...(s.violations ?? []), { kind, at: nowIso(), question_index: s.cursor.question_index, detail }],
  })
  return count
}

export function submitQualification(sessionId, answers) {
  const s = getSession(sessionId)
  if (!s || s.state !== 'in_progress') throw new Error('This interview is not in progress.')
  db.update('interview_sessions', sessionId, { qualification_answers: { ...answers, submitted_at: nowIso() } })
  return getSession(sessionId)
}

/** What the recorder captured. The video itself is in IndexedDB (lib/media.js). */
export function setRecordingMeta(sessionId, meta) {
  const s = getSession(sessionId)
  if (!s) return
  db.update('interview_sessions', sessionId, { recording: { ...(s.recording ?? {}), ...meta } })
}

/**
 * Finish. The candidate is done and leaves; scoring happens behind them.
 */
export async function completeSession(sessionId, endReason = 'all_questions_answered') {
  const s = getSession(sessionId)
  if (s.state === 'completed') return getReportForSession(sessionId)

  const duration = s.started_at ? Math.round((Date.now() - new Date(s.started_at).getTime()) / 1000) : null
  db.update('interview_sessions', sessionId, {
    state: 'completed',
    ended_at: nowIso(),
    duration_seconds: duration,
    end_reason: endReason,
  })

  systemMoveStage(s.application_id, 'interview_completed')
  logActivity({
    type: 'interview.completed',
    subject_type: 'application',
    subject_id: s.application_id,
    summary: `${s.plan.candidate_context?.full_name} finished their interview`,
    by: 'candidate',
  })

  return generateReport(sessionId)
}

// --- scoring and the report (§14) ------------------------------------------

export async function generateReport(sessionId) {
  const session = getSession(sessionId)
  // Scored against the session's OWN frozen plan — never the live job.
  const qualification = session.plan.qualification?.length
    ? evaluateQualification(session.plan.qualification, session.qualification_answers ?? {})
    : null
  const interviewed = session.plan.questions.length > 0
  const scored = interviewed ? await scoreSession({ session }) : questionnaireOnlyReport(session, qualification)
  if (qualification?.knockouts.length) {
    scored.concerns = [
      ...qualification.knockouts.map((k) => `Questionnaire: "${k}" — answer is outside what the role needs.`),
      ...scored.concerns.filter((c) => !/^No material concerns/.test(c)),
    ]
    // A knockout never rejects on its own; it stops an automatic "recommended".
    if (scored.recommendation === 'shortlist') scored.recommendation = 'hold'
  }
  scored.qualification = qualification
  scored.integrity = integritySummary(session)
  if (scored.integrity.auto_terminated) {
    scored.concerns = [`Interview ended automatically: ${scored.integrity.reason}.`, ...scored.concerns]
    if (scored.recommendation === 'shortlist') scored.recommendation = 'hold'
  }
  scored.recommendation_reason = recommendationReason(scored, session)

  const existing = db.findOne('interview_reports', { session_id: sessionId })
  const shareToken = existing?.share_token ?? newToken()

  const payload = {
    session_id: sessionId,
    application_id: session.application_id,
    candidate_id: session.candidate_id,
    job_id: session.job_id,
    share_token: shareToken,
    ...scored,
    regenerated_count: existing ? (existing.regenerated_count ?? 0) + 1 : 0,
    recruiter_verdict: existing?.recruiter_verdict ?? null,
  }

  const report = existing
    ? db.replace('interview_reports', existing._id, { ...payload, _id: existing._id })
    : db.insert('interview_reports', { _id: newId(), ...payload })

  db.update('interview_sessions', sessionId, { report_id: report._id })

  // Denormalised head of the latest session, so a pipeline list never has to
  // open a session document (§9.5).
  const app = getApplication(session.application_id)
  db.update('applications', session.application_id, {
    interview_summary: {
      session_id: sessionId,
      state: 'completed',
      overall_score: report.overall_score,
      recommendation: report.recommendation,
      completed_at: nowIso(),
      attempts: app.interview_summary?.attempts ?? session.attempt,
    },
  })

  logActivity({
    type: 'interview.scored',
    subject_type: 'application',
    subject_id: session.application_id,
    summary: `Report ready — ${report.overall_score}/100, ${report.recommendation}`,
    by: 'system',
  })
  return report
}

function questionnaireOnlyReport(session, qualification) {
  const knocked = qualification?.knockouts ?? []
  return {
    conducted_in: session.plan.rules.language,
    overall_score: null,
    recommendation: knocked.length ? 'hold' : 'shortlist',
    confidence: qualification && qualification.answered === qualification.total ? 'high' : 'medium',
    headline: knocked.length
      ? `Questionnaire complete — ${knocked.length} answer${knocked.length === 1 ? '' : 's'} outside what the role needs.`
      : 'Questionnaire complete — every answer is within what the role needs.',
    competencies: [],
    skills: [],
    communication: null,
    per_question: [],
    strengths: knocked.length ? [] : ['All questionnaire answers are within range.'],
    concerns: ['No AI interview was part of this assessment.'],
    follow_up_questions: ['Call to confirm the questionnaire answers and discuss the role.'],
    signals: {
      speech: { words_per_minute: 0, avg_answer_words: 0 },
      coverage: { questions_answered: qualification?.answered ?? 0, questions_planned: qualification?.total ?? 0 },
    },
    model: { name: 'local-heuristic', prompt_version: 'qualification-2026.09.1' },
    generated_at: new Date().toISOString(),
  }
}

const END_REASONS = {
  all_questions_answered: 'All questions answered',
  candidate_ended: 'Candidate ended the interview',
  auto_terminated_tab_switches: 'too many tab switches',
  auto_terminated_face: 'candidate left the camera frame repeatedly',
  timeout: 'no activity for 30 minutes',
  time_limit: 'Time limit reached',
  connection_lost: 'Connection to the interviewer was lost',
}
export const endReasonLabel = (r) => END_REASONS[r] ?? (r ?? '').replace(/_/g, ' ')

function integritySummary(session) {
  const i = session.integrity ?? {}
  const auto = String(session.end_reason ?? '').startsWith('auto_terminated')
  const total = (i.tab_switches ?? 0) + (i.paste_events ?? 0) + (i.face_missing ?? 0) + (i.multiple_faces ?? 0) + (i.fullscreen_exits ?? 0)
  return {
    tab_switches: i.tab_switches ?? 0,
    paste_events: i.paste_events ?? 0,
    face_missing: i.face_missing ?? 0,
    multiple_faces: i.multiple_faces ?? 0,
    fullscreen_exits: i.fullscreen_exits ?? 0,
    total,
    auto_terminated: auto,
    reason: auto ? endReasonLabel(session.end_reason) : null,
    level: auto ? 'high' : total >= 3 ? 'medium' : total > 0 ? 'low' : 'none',
  }
}

/** The "why" behind the badge, in one or two plain sentences. */
function recommendationReason(r, session) {
  const threshold = session.plan.scoring.shortlist_threshold
  const parts = []
  if (r.overall_score != null) {
    parts.push(
      r.overall_score >= threshold
        ? `Scored ${r.overall_score}/100, at or above the ${threshold} needed for this role.`
        : `Scored ${r.overall_score}/100, below the ${threshold} needed for this role.`,
    )
    const top = [...(r.competencies ?? [])].filter((c) => c.score != null).sort((a, b) => b.score - a.score)
    if (top.length > 1) parts.push(`Strongest on ${top[0].label.toLowerCase()} (${top[0].score}); weakest on ${top.at(-1).label.toLowerCase()} (${top.at(-1).score}).`)
  }
  if (r.qualification?.knockouts.length) parts.push(`${r.qualification.knockouts.length} questionnaire answer(s) flagged.`)
  if (r.integrity?.auto_terminated) parts.push(`The interview was ended automatically (${r.integrity.reason}).`)
  else if (r.integrity?.total) parts.push(`${r.integrity.total} integrity event(s) were recorded — review before deciding.`)
  return parts.join(' ')
}

export function getReport(id) {
  return db.findOne('interview_reports', id)
}

export function getReportForSession(sessionId) {
  return db.findOne('interview_reports', { session_id: sessionId })
}

export function getReportByShareToken(token) {
  return db.all('interview_reports').find((r) => r.share_token === token) ?? null
}

export function listReports({ job_id } = {}) {
  let rows = db.all('interview_reports')
  if (job_id) rows = rows.filter((r) => r.job_id === job_id)
  return rows.sort((a, b) => b.generated_at.localeCompare(a.generated_at))
}

/**
 * The recruiter's verdict.
 *
 * `agreed_with_ai` is the report-trust metric (§1.2): a single boolean that,
 * aggregated, says whether the AI is earning its place. It costs the recruiter
 * nothing — it is derived from which button they press.
 */
export function recordVerdict(reportId, decision, note) {
  const report = getReport(reportId)
  const agreed =
    (decision === 'shortlist' && report.recommendation === 'shortlist') ||
    (decision === 'reject' && report.recommendation === 'reject') ||
    (decision === 'hold' && report.recommendation === 'hold')

  db.update('interview_reports', reportId, {
    recruiter_verdict: {
      decision,
      by: currentUser()?.username ?? 'system',
      at: nowIso(),
      agreed_with_ai: agreed,
      note: note ?? '',
    },
  })

  const stage = { shortlist: 'shortlisted', reject: 'rejected', hold: 'on_hold' }[decision]
  if (stage) moveStage(report.application_id, stage, note)
  return getReport(reportId)
}
