// The AI voice interview, run by the InterviewBot server (a live call with a
// Sarvam voice agent), translated to and from ProHire's own shapes.
//
// ProHire stays where the recruiter works: the candidate's details come from
// their record, the recruiter chooses the questions and settings, and the
// report is read here like any other. The InterviewBot only runs the call. So
// this file is the whole contract between the two, in both directions:
//
//   toBotPlan()      ProHire's frozen plan → what the InterviewBot runs
//   sessionFromBot() the call as it happened → ProHire's session fields
//   reportFromBot()  the InterviewBot's report → ProHire's report shape
//
// Pure: no storage, no network, so each direction can be checked on its own.

/** The voice agent speaks English and Hindi; nothing else is offered for a call. */
export const BOT_LANGUAGES = ['en-IN', 'hi-IN']
export const DEFAULT_ANSWER_PAUSE = 2.5
/** "Warn only" and "don't check": the bot always ends past its limit, so make the limit unreachable. */
const NEVER = 99

export const isBotPlan = (plan) => plan?.rules?.mode === 'call'

/**
 * @param plan       the resolved (or frozen) ProHire plan
 * @param job        the job record
 * @param candidate  the candidate record — name, role, experience, skills are
 *                   read from here, never typed by the recruiter
 */
export function toBotPlan({ plan, job, candidate, company, links = {} }) {
  const p = plan.rules.proctoring ?? {}
  const checksTabs = p.tab_switch_warning !== false && p.auto_terminate !== false
  const primary = job?.primary_skill ?? plan.job_context?.primary_skill ?? null
  return {
    company,
    job: {
      id: job?._id,
      reference: job?.reference ?? plan.job_context?.reference,
      title: job?.title ?? plan.job_context?.title,
      department: job?.department_name ?? null,
      location: job?.location?.city ?? null,
      skills_required: job?.skills_required ?? plan.job_context?.skills_required ?? [],
      primary_skill: primary,
      primary_skill_min_years: job?.primary_skill_min_years ?? null,
      experience: job?.experience_level ?? null,
    },
    candidate: {
      id: candidate?._id,
      name: candidate?.full_name ?? plan.candidate_context?.full_name,
      reference: candidate?.reference ?? null,
      experience_years: candidate?.total_experience_years ?? plan.candidate_context?.total_experience_years ?? null,
      current: { title: candidate?.current?.title ?? null, company: candidate?.current?.company ?? null },
      location: candidate?.location?.city ?? null,
      skills: candidate?.parsed?.skills ?? plan.candidate_context?.skills ?? [],
      languages: candidate?.parsed?.languages ?? [],
    },
    settings: {
      language: plan.rules.language === 'hi-IN' ? 'Hindi' : 'English',
      strictness: plan.rules.strictness,
      duration_minutes: plan.rules.duration_minutes,
      max_questions: plan.questions.length,
      follow_ups_per_question: plan.rules.follow_ups_per_question ?? 1,
      interviewer_name: plan.persona?.name,
      instructions: plan.rules.instructions ?? '',
      max_tab_switches: checksTabs ? (p.max_tab_switches ?? 3) : NEVER,
      answer_pause_seconds: plan.rules.answer_pause_seconds ?? DEFAULT_ANSWER_PAUSE,
    },
    questions: plan.questions.map((q) => ({
      id: q.id,
      text: q.text,
      text_hi: q.text_hi ?? '',
      must_ask: Boolean(q.must_ask),
      skill: q.skill ?? (q.primary ? primary : null),
    })),
    prohire: links,
  }
}

// --- the call, as it happened -----------------------------------------------------

const count = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).length

/** ProHire session fields from the InterviewBot's session. */
export function sessionFromBot(bot, { botUrl } = {}) {
  const turns = (bot.turns ?? []).map((t, i) => ({
    seq: i + 1,
    at: t.at,
    role: t.role === 'candidate' ? 'candidate' : 'interviewer',
    kind: 'message',
    text: t.text,
    ...(t.role === 'candidate' ? { words: count(t.text) } : {}),
  }))
  const leaves = (bot.events ?? []).filter((e) => e.kind === 'tab_switch')
  const answered = turns.some((t) => t.role === 'candidate')
  const state = bot.status === 'live' ? 'in_progress'
    : bot.status === 'ended' ? (answered ? 'completed' : 'abandoned')
    : 'invited'
  const duration = bot.started_at && bot.ended_at
    ? Math.max(0, Math.round((new Date(bot.ended_at) - new Date(bot.started_at)) / 1000))
    : null
  return {
    state,
    turns,
    started_at: bot.started_at ?? null,
    ended_at: bot.ended_at ?? null,
    duration_seconds: duration,
    end_reason: bot.end_reason ?? null,
    integrity_tab_switches: leaves.length,
    violations: leaves.map((e) => ({ kind: 'tab_switches', at: e.at, question_index: null })),
    recording: bot.recording && botUrl
      ? { available: true, remote: true, url: `${botUrl}/api/sessions/${bot.id}/recording`, started_at: bot.started_at }
      : null,
    fairness: fairnessFromBot(bot),
  }
}

// What the fairness checks measured (see InterviewBot README, "Fairness
// checks"). The browser sends its summary as the interview page closes; until
// then, the live events it sent along the way are added up instead.
const CAMERA_KINDS = ['multiple_faces', 'no_face', 'looking_away', 'voice_without_lips', 'phone_visible']

export function fairnessFromBot(bot) {
  const p = bot.proctoring ?? {}
  const v = bot.voice_check ?? {}
  const events = bot.events ?? []
  const secondsOf = (kind) => Math.round(events
    .filter((e) => e.kind === kind)
    .reduce((n, e) => n + (Number(e.detail?.seconds) || 0), 0) * 10) / 10
  const seconds = Object.fromEntries(CAMERA_KINDS.map((k) => [k, p.totals?.[k] ?? secondsOf(k)]))
  const answers = p.answers ?? []
  return {
    summary_received: Boolean(bot.proctoring),
    camera: p.face_check ?? (bot.status === 'ended' ? 'not_received' : 'running'),   // on | unavailable | not_received | running
    camera_reason: p.reason ?? null,
    people_check: p.people_check ?? null,          // 'faces only' | 'faces and people'
    face_visible_share: p.face_visible_share ?? null,
    seconds,
    window_away_seconds: secondsOf('window_blur'),
    tab_switches: events.filter((e) => e.kind === 'tab_switch').length,
    reading_answers: answers.filter((a) => a.reading_like).length,
    answers_checked: answers.length,
    second_display: Boolean(p.screen_extended),
    virtual_camera: p.virtual_camera ?? null,
    voice_check: {
      status: v.status ?? 'not_run',               // done | failed | off | not_run
      level: v.level ?? null,
      other_seconds: v.other_seconds ?? null,
      prompted: (v.segments ?? []).some((s) => s.prompted),
    },
  }
}

// --- the report -------------------------------------------------------------------------

const ten = (v) => (v == null ? null : Math.round(v * 10))
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const LEVEL = { none: 'none', review: 'medium', serious: 'high' }

function headlineFor(r) {
  if (r.error) return 'AI scoring was not available, so this report is incomplete.'
  return {
    insufficient: 'Not enough was said to judge — speak to them before deciding.',
    shortlist: 'Above the bar for this role.',
    hold: 'Close to the bar — worth a closer look.',
    reject: 'Below the bar for this role.',
  }[r.outcome] ?? 'Interview scored.'
}

/**
 * The InterviewBot's report in ProHire's shape, so ReportView, the pipeline and
 * the Reports page read it like any other. Its scores are out of 10; ProHire's
 * are out of 100. Its rules (verbatim quotes only, unasked skills not scored,
 * thin evidence → hold, never reject) come across unchanged.
 */
export function reportFromBot(r, { plan, turns = [], durationSeconds = null }) {
  const skills = (r.skills ?? [])
    .filter((s) => s.asked && s.score != null)
    .map((s) => ({
      skill: s.skill, primary: Boolean(s.primary), score: ten(s.score), out_of_10: s.score,
      evidence: s.evidence ?? '', strength: s.strength ?? '', improvement: s.improvement ?? '', interpretation: s.interpretation ?? '',
    }))
  const soft = r.soft_skills ?? {}
  const hasSoft = Object.values(soft).some((v) => v?.score != null)

  // The model echoes each planned question; match on the words, and on position
  // only when it returned exactly one entry per planned question.
  const botQuestions = r.questions ?? []
  const byPosition = botQuestions.length === plan.questions.length
  const perQuestion = plan.questions.map((q, i) => {
    const b = botQuestions.find((x) => norm(x.question) === norm(q.text)) ?? (byPosition ? botQuestions[i] : null)
    return {
      question_id: q.id, question: q.text, competency: q.competency, weight: q.weight ?? 1,
      answered: Boolean(b?.answered), score: null, max: 5, rationale: b?.summary ?? '',
      covered_points: [], missed_points: [],
    }
  })

  const answers = turns.filter((t) => t.role === 'candidate')
  const words = r.evidence?.candidate_words ?? answers.reduce((n, t) => n + (t.words ?? count(t.text)), 0)
  const answered = r.evidence?.answered ?? perQuestion.filter((p) => p.answered).length
  const planned = r.evidence?.planned ?? plan.questions.length
  const fair = r.proctoring ?? {}
  const tabs = fair.tab_switches ?? 0
  const signals = fair.signals ?? []

  return {
    source: 'interview_bot',
    conducted_in: plan.rules.language,
    overall_score: ten(r.overall),
    recommendation: r.recommendation ?? 'hold',
    confidence: !r.evidence?.enough ? 'low' : answered >= planned ? 'high' : 'medium',
    headline: headlineFor(r),
    recommendation_reason: r.rationale ?? '',
    summary: r.summary ?? '',
    observations: r.observations ?? [],
    competencies: [
      { key: 'technical', label: 'Technical skills', weight: 0.7, score: ten(r.technical), evidence: skills.map((s) => s.evidence).filter(Boolean).slice(0, 3) },
      { key: 'soft', label: 'Soft skills', weight: 0.3, score: ten(r.soft), evidence: [] },
    ],
    skills,
    communication: hasSoft
      ? {
          fluency: ten(soft.fluency?.score), confidence: ten(soft.confidence?.score),
          composure: ten(soft.composure?.score), communication: ten(soft.communication?.score),
          reasons: Object.fromEntries(Object.entries(soft).map(([k, v]) => [k, v?.reason ?? ''])),
        }
      : null,
    per_question: perQuestion,
    strengths: r.strengths?.length ? r.strengths : ['Nothing stood out as a clear strength.'],
    concerns: r.concerns?.length ? r.concerns : ['No material concerns raised by the transcript.'],
    follow_up_questions: r.ask_next_round?.length ? r.ask_next_round : ['Nothing specific — run a standard round.'],
    integrity: {
      tab_switches: tabs, paste_events: 0, face_missing: 0, multiple_faces: 0, fullscreen_exits: 0,
      total: tabs + signals.filter((s) => s.kind !== 'tab_switch').length,
      auto_terminated: Boolean(fair.auto_terminated),
      reason: fair.auto_terminated ? 'too many tab switches' : null,
      level: fair.auto_terminated ? 'high' : LEVEL[fair.level] ?? 'none',
      verdict: fair.verdict ?? null,
      signals,
    },
    signals: {
      speech: {
        words_per_minute: durationSeconds ? Math.round(words / Math.max(1, durationSeconds / 60)) : 0,
        avg_answer_words: answers.length ? Math.round(words / answers.length) : 0,
      },
      coverage: { questions_answered: answered, questions_planned: planned },
    },
    model: { name: r.model ?? 'none', prompt_version: 'interviewbot' },
    bot_generated_at: r.generated_at ?? null,
    generated_at: r.generated_at ?? new Date().toISOString(),
  }
}
