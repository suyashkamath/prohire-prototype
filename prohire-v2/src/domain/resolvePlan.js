// §11 — the central design problem, and its answer.
//
// Interview configuration is a LAYERED SPARSE PATCH:
//
//     org default → department → job → candidate override → invite-time tweaks
//
// Each layer overrides only the fields it sets. `resolvePlan` flattens them
// into one materialised plan, which is then FROZEN into the session at invite
// time (§11.5). Freezing is what makes all four guarantees true at once:
// editing a job later cannot change a finished report; two candidates on one
// job can have different questions, languages and durations; and a report from
// a year ago still renders even if the job was deleted.
//
// This function is PURE — templates in, plan out, no I/O — so it can be
// exercised directly from the Interview Setup screen to show a live preview
// with provenance.

import { LANGUAGES } from './locations.js'

export const STRICTNESS = {
  lenient:  { label: 'Lenient',  threshold: 60, followUps: 'rarely',    tone: 'Encouraging; offers hints' },
  moderate: { label: 'Moderate', threshold: 70, followUps: 'when vague', tone: 'Neutral, professional' },
  strict:   { label: 'Strict',   threshold: 80, followUps: 'always',     tone: 'Neutral, no hints' },
}

/**
 * The interviewer's default name. Deliberately not the vendor's ("Erica") —
 * Settings changes it for the whole organisation in one place.
 */
export const DEFAULT_PERSONA_NAME = 'Aarya'

/**
 * What the candidate is asked to do.
 *   qualification — a short typed questionnaire (notice period, CTC, "are you
 *                   okay with field work?"). No AI conversation.
 *   interview     — the AI interview only.
 *   both          — the questionnaire first, then the interview.
 */
export const ASSESSMENT_TYPES = {
  interview:     { label: 'AI interview only' },
  qualification: { label: 'Questionnaire only' },
  both:          { label: 'Questionnaire + AI interview' },
}

export const INTERVIEW_MODES = {
  // The AI screening round: every new interview is this one. The others stay so
  // interviews sent before still read correctly.
  call:  { label: 'AI video interview', detail: 'A live spoken interview with the AI interviewer, on camera and recorded, in English or Hindi.' },
  video: { label: 'Video', detail: 'Camera on, recorded. Questions are spoken aloud.' },
  voice: { label: 'Voice', detail: 'Questions spoken aloud; candidate speaks or types.' },
  text:  { label: 'Typed', detail: 'Questions on screen; candidate types answers.' },
}

/**
 * Every AI video interview opens with this, before any other question. It is
 * added when the plan is built, so no job, candidate or invite can leave it
 * out, and a copy of it elsewhere in the list is dropped rather than asked twice.
 */
export const INTRO_QUESTION = {
  id: 'intro',
  text: 'Tell me about yourself.',
  text_hi: 'अपने बारे में बताइए।',
  type: 'open',
  competency: 'communication',
  weight: 1,
  must_ask: true,
  fixed: true,
}
const INTRO_RE = /\btell (me|us) (a (little|bit) )?(more )?about yourself\b|अपने बारे में (कुछ )?(बताइए|बताइये|बताओ|बताएं)/i
export const isIntroQuestion = (q) => q?.id === INTRO_QUESTION.id || INTRO_RE.test(q?.text ?? '')

/** The org default. Always exists, so configuration is never required (§11.4). */
export const ORG_DEFAULT_RULES = {
  strictness: 'moderate',
  language: 'en-IN',
  duration_minutes: 30,
  light_mode: false,
  mode: 'video',
  assessment_type: 'interview',
  max_questions: 8,
  follow_ups_per_question: 1,
  allow_retake: false,
  // AI voice call only: what the interviewer is told beyond the questions, and
  // how long a silence ends an answer (shorter pauses are the candidate thinking).
  instructions: '',
  answer_pause_seconds: 2.5,
  // Integrity rules. Tab switches get a visible warning each time; one more
  // than `max_tab_switches` ends the interview when `auto_terminate` is on.
  proctoring: {
    tab_switch_warning: true,
    max_tab_switches: 3,
    auto_terminate: true,
    paste_detection: true,
    face_presence: true,
  },
}

export const DEFAULT_COMPETENCIES = [
  { key: 'technical',     label: 'Technical depth',     weight: 0.4 },
  { key: 'experience',    label: 'Relevant experience', weight: 0.3 },
  { key: 'communication', label: 'Communication',       weight: 0.2 },
  { key: 'ownership',     label: 'Ownership',           weight: 0.1 },
]

const SCALAR_RULES = [
  'strictness', 'language', 'duration_minutes', 'light_mode', 'mode',
  'assessment_type', 'max_questions', 'follow_ups_per_question', 'allow_retake',
  'instructions', 'answer_pause_seconds',
]

/**
 * Apply one layer's question operations. A lower layer adjusts the set without
 * restating it — the reason a candidate override is three lines and not a
 * cloned job (§11.3).
 */
function applyQuestionOps(questions, ops = []) {
  let out = questions.map((q) => ({ ...q }))
  for (const op of ops) {
    switch (op.op) {
      case 'add':
        out.push({ ...op.question })
        break
      case 'remove':
        out = out.filter((q) => q.id !== op.question_id)
        break
      case 'replace': {
        const i = out.findIndex((q) => q.id === op.question_id)
        if (i !== -1) out[i] = { ...out[i], ...op.question }
        break
      }
      case 'reorder': {
        const byId = new Map(out.map((q) => [q.id, q]))
        const ordered = op.order.map((id) => byId.get(id)).filter(Boolean)
        // Anything the order forgot keeps its place at the end rather than
        // vanishing — a partial reorder must never drop a question.
        const rest = out.filter((q) => !op.order.includes(q.id))
        out = [...ordered, ...rest]
        break
      }
      default:
        break
    }
  }
  return out
}

/**
 * @param layers  ordered, lowest precedence first. Each is
 *                { source, rules?, questions?, question_ops?, scoring?, persona? }
 *                where `source` is a human string used for provenance.
 */
export function resolvePlan(layers, { job, candidate } = {}) {
  const rules = { ...ORG_DEFAULT_RULES }
  const provenance = {}
  for (const k of Object.keys(rules)) provenance[k] = 'org default'

  let questions = []
  let qualification = []
  let scoring = { competencies: DEFAULT_COMPETENCIES, shortlist_threshold: null }
  let persona = { name: DEFAULT_PERSONA_NAME }

  for (const layer of layers) {
    if (!layer) continue

    for (const k of SCALAR_RULES) {
      // Last non-null layer wins. `undefined` and `null` both mean "not set by
      // this layer" — only an explicit value overrides.
      if (layer.rules && layer.rules[k] != null) {
        rules[k] = layer.rules[k]
        provenance[k] = layer.source
      }
    }
    if (layer.rules?.proctoring) {
      rules.proctoring = { ...rules.proctoring, ...layer.rules.proctoring }
      provenance.proctoring = layer.source
    }

    // Questions: a layer either states them wholesale or patches them.
    if (layer.questions) {
      questions = layer.questions.map((q) => ({ ...q }))
      provenance.questions = layer.source
    }
    if (layer.question_ops?.length) {
      questions = applyQuestionOps(questions, layer.question_ops)
      provenance.questions = layer.source
    }

    // The questionnaire is short and states itself wholesale; a layer that
    // sets it replaces it.
    if (layer.qualification?.length) {
      qualification = layer.qualification.map((q) => ({ ...q }))
      provenance.qualification = layer.source
    }

    // Competencies replace wholesale — partial weights would not sum to 1.
    if (layer.scoring?.competencies) {
      scoring = { ...scoring, competencies: layer.scoring.competencies }
      provenance.competencies = layer.source
    }
    if (layer.scoring?.shortlist_threshold != null) {
      scoring = { ...scoring, shortlist_threshold: layer.scoring.shortlist_threshold }
      provenance.shortlist_threshold = layer.source
    }

    if (layer.persona) persona = { ...persona, ...layer.persona }
  }

  // light_mode is a shortcut, not an independent setting (§12.5): it means
  // 15 minutes and at most 5 questions. Applied after the merge so that any
  // layer switching it on gets the full effect.
  if (rules.light_mode) {
    rules.duration_minutes = 15
    rules.max_questions = Math.min(rules.max_questions, 5)
    provenance.duration_minutes = `${provenance.light_mode} (light mode)`
    provenance.max_questions = `${provenance.light_mode} (light mode)`
  }

  // The threshold follows strictness unless a layer set it by hand. Changing
  // the rubric and the threshold together is what keeps scores comparable
  // across strictness settings (§12.4).
  if (scoring.shortlist_threshold == null) {
    scoring = { ...scoring, shortlist_threshold: STRICTNESS[rules.strictness].threshold }
    provenance.shortlist_threshold = `strictness: ${rules.strictness}`
  }

  // The voice is DERIVED from the resolved language, never set by hand (§11.3).
  const lang = LANGUAGES.find((l) => l.code === rules.language) ?? LANGUAGES[0]
  persona = { ...persona, voice_id: lang.voice, language_label: lang.label }

  // The AI video interview always starts with "Tell me about yourself".
  if (rules.mode === 'call' && rules.assessment_type !== 'qualification') {
    questions = [{ ...INTRO_QUESTION }, ...questions.filter((q) => !isIntroQuestion(q))]
  }

  // Trim to the question budget, dropping optional questions lowest-weight
  // first — never a must_ask (§12.5).
  //
  // The budget is the tighter of two limits: the explicit `max_questions`, and
  // what the resolved duration can actually hold. Setting a 15-minute interview
  // has to MEAN something on its own; requiring the recruiter to also remember
  // to lower the question count would be a trap, and the candidate would be the
  // one who discovered it.
  const trimmed = rules.assessment_type === 'qualification'
    ? { questions: [], dropped: [] }
    : trimToBudget(questions, Math.min(rules.max_questions, questionsThatFit(rules)))

  return {
    persona,
    rules,
    questions: trimmed.questions,
    qualification: rules.assessment_type === 'interview' ? [] : qualification,
    dropped: trimmed.dropped,
    scoring,
    provenance,
    job_context: job
      ? {
          title: job.title,
          reference: job.reference,
          description: job.description,
          skills_required: job.skills_required ?? [],
          primary_skill: job.primary_skill ?? null,
          primary_skill_min_years: job.primary_skill_min_years ?? null,
        }
      : null,
    candidate_context: candidate
      ? {
          full_name: candidate.full_name,
          current: candidate.current ?? {},
          skills: candidate.parsed?.skills ?? [],
          total_experience_years: candidate.total_experience_years ?? null,
        }
      : null,
  }
}

/**
 * How many questions fit in the resolved duration.
 *
 * MINUTES_PER_QUESTION is deliberately generous: a question plus the follow-up
 * it may earn plus the pause before the answer starts. Under-filling an
 * interview is recoverable; running a candidate past their expected finish time
 * is not.
 */
const MINUTES_PER_QUESTION = 3

export function questionsThatFit(rules) {
  return Math.max(1, Math.floor(rules.duration_minutes / MINUTES_PER_QUESTION))
}

function trimToBudget(questions, max) {
  if (questions.length <= max) return { questions, dropped: [] }
  const mustAsk = questions.filter((q) => q.must_ask)
  const optional = questions.filter((q) => !q.must_ask)

  // A plan whose must_ask questions alone overflow the budget is a
  // configuration error the recruiter must see — it is surfaced by
  // validatePlan below, not silently truncated here.
  const room = Math.max(0, max - mustAsk.length)
  const sortedOptional = [...optional].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))
  const keep = new Set([...mustAsk, ...sortedOptional.slice(0, room)].map((q) => q.id))

  return {
    questions: questions.filter((q) => keep.has(q.id)),
    dropped: questions.filter((q) => !keep.has(q.id)),
  }
}

/**
 * Fail early, in front of the recruiter, not in front of the candidate (§12.5).
 */
export function validatePlan(plan) {
  const problems = []
  const mustAsk = plan.questions.filter((q) => q.must_ask).length

  const type = plan.rules.assessment_type ?? 'interview'
  if (plan.rules.mode === 'call') {
    // The voice agent speaks English and Hindi, and it runs the conversation
    // only — a typed questionnaire is sent as its own assessment.
    if (!['en-IN', 'hi-IN'].includes(plan.rules.language)) {
      problems.push('The AI video interview runs in English or Hindi. Choose one of those.')
    }
    if (type !== 'interview') {
      problems.push('The AI video interview is the interview only; it has no typed questionnaire.')
    }
  }
  if (type !== 'qualification' && plan.questions.length === 0) {
    problems.push('This plan has no interview questions.')
  }
  if (type !== 'interview' && !(plan.qualification ?? []).length) {
    problems.push('A questionnaire was chosen, but it has no questions. Add some under Interview setup → Questionnaire.')
  }
  // Optional questions are already trimmed to fit, so the only genuine failure
  // is a plan whose MUST-ASK questions alone overflow — and that is a
  // configuration error the recruiter has to see, because nothing downstream
  // can resolve it without silently dropping a question someone insisted on.
  const budget = Math.min(plan.rules.max_questions, questionsThatFit(plan.rules))
  if (mustAsk > budget) {
    problems.push(
      `${mustAsk} questions are marked "must ask", but ` +
      `${plan.rules.duration_minutes} minutes and a limit of ${plan.rules.max_questions} ` +
      `leave room for ${budget}. Lengthen the interview, raise the limit, or unmark some.`,
    )
  }
  const weightSum = plan.scoring.competencies.reduce((s, c) => s + c.weight, 0)
  if (Math.abs(weightSum - 1) > 0.01) {
    problems.push(`Competency weights sum to ${weightSum.toFixed(2)}, not 1.00.`)
  }
  return problems
}

/** A stable, deep copy for the session. This IS the freeze (§11.5). */
export function freeze(plan, resolvedFrom) {
  return {
    ...structuredClone(plan),
    resolved_from: resolvedFrom,
    frozen_at: new Date().toISOString(),
  }
}
