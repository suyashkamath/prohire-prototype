// The two places a machine forms a judgement.
//
//   AI #1 · screening  — resume + JD → match % · decision · write-up
//   AI #2 · interview  — frozen plan + candidate → transcript · scores · report
//
// Everything else in ProHire is a human decision, deliberately.
//
// -----------------------------------------------------------------------------
// This prototype runs both LOCALLY and DETERMINISTICALLY. No API key, no
// network, no cost — you can demo it on a plane. The tradeoff is real and worth
// stating: this engine matches keywords and measures answer substance. It does
// not understand anything.
//
// It is here rather than stubbed because the product questions the prototype
// exists to answer — does the report shape work? is the evidence panel worth
// the space? does the freeze hold? — are all answerable without a real model,
// and none of them are answerable without a working pipeline.
//
// Every export below is async and returns exactly the shape the real engine
// must return, so replacing this file with calls to GPT-4o changes nothing
// above it. That boundary is the point.
// -----------------------------------------------------------------------------

import { STRICTNESS } from './resolvePlan.js'

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const STOP_WORDS = new Set([
  'the','and','for','with','that','this','from','have','has','are','was','were','will',
  'you','your','our','their','they','them','a','an','of','to','in','on','at','by',
  'as','is','be','it','or','we','i','my','me','not','but','so','if','then','than','can',
  'all','any','who','what','when','which','how','also','more','most','been','had','do',
  'does','did','about','into','over','out','up','down','just','very','much','some','such',
])

function tokens(text = '') {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^[.]+|[.]+$/g, ''))
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
}

function skillPresent(skill, text) {
  const hay = text.toLowerCase()
  const needle = skill.toLowerCase()
  const i = hay.indexOf(needle)
  if (i === -1) return false
  const isWordChar = (c) => c != null && /[a-z0-9]/.test(c)
  return !isWordChar(hay[i - 1]) && !isWordChar(hay[i + needle.length])
}

// ---------------------------------------------------------------------------
// AI #1 · Screening
// ---------------------------------------------------------------------------

/**
 * Score one resume against one job.
 *
 * The threshold rule is applied by the CALLER's business logic, not by this
 * function's opinion: a score below the job's threshold is a forced Reject and
 * the reason is rewritten to say so. That separation matters — the model
 * produces a number, the business decides what the number means.
 */
export async function screenResume({ job, candidate, resumeText }) {
  await delay(280 + Math.random() * 420) // the shape of a real API call

  const required = job.skills_required ?? []
  const preferred = job.skills_preferred ?? []
  const haystack = [
    resumeText ?? '',
    (candidate.parsed?.skills ?? []).join(' '),
    candidate.current?.title ?? '',
    candidate.current?.company ?? '',
  ].join('\n')

  const hitRequired = required.filter((s) => skillPresent(s, haystack))
  const missRequired = required.filter((s) => !hitRequired.includes(s))
  const hitPreferred = preferred.filter((s) => skillPresent(s, haystack))

  // --- the score, component by component, so the write-up can explain it ---

  // Required skills are 55 points. With no required skills listed, fall back to
  // free-text overlap with the JD so the score still means something.
  let skillScore
  if (required.length) {
    skillScore = (hitRequired.length / required.length) * 55
  } else {
    const jd = new Set(tokens(job.description))
    const cv = new Set(tokens(haystack))
    const overlap = [...jd].filter((t) => cv.has(t)).length
    skillScore = jd.size ? Math.min(55, (overlap / jd.size) * 110) : 27
  }

  // Preferred skills are a 10-point bonus, never a penalty.
  const preferredScore = preferred.length ? (hitPreferred.length / preferred.length) * 10 : 5

  // Experience is 25 points, with a band rather than a cliff: under the
  // minimum loses proportionally, well over it loses a little (overqualified
  // is a real signal, not a disqualification).
  const years = candidate.total_experience_years
  const min = job.experience?.min_years ?? 0
  const max = job.experience?.max_years ?? min + 5
  let expScore
  let expNote
  if (years == null) {
    expScore = 12
    expNote = 'Experience could not be read from the resume.'
  } else if (years < min) {
    const shortfall = min - years
    expScore = Math.max(0, 25 - shortfall * 8)
    expNote = `${years} years against a ${min}-year minimum — ${shortfall.toFixed(1)} short.`
  } else if (years > max + 3) {
    expScore = 18
    expNote = `${years} years is well above the ${min}–${max} band for this role.`
  } else {
    expScore = 25
    expNote = `${years} years sits inside the ${min}–${max} band.`
  }

  // Free-text relevance against the JD is the last 10 points — it catches
  // domain fit that a skills list misses.
  const jdTokens = new Set(tokens(job.description))
  const cvTokens = new Set(tokens(haystack))
  const overlap = [...jdTokens].filter((t) => cvTokens.has(t)).length
  const contextScore = jdTokens.size ? Math.min(10, (overlap / jdTokens.size) * 30) : 5

  const raw = skillScore + preferredScore + expScore + contextScore
  const matchPercent = Math.max(1, Math.min(99, Math.round(raw)))

  const pros = []
  const cons = []

  if (hitRequired.length) {
    pros.push(`Has ${hitRequired.length} of ${required.length} required skills: ${hitRequired.join(', ')}.`)
  }
  if (hitPreferred.length) pros.push(`Also brings preferred skills: ${hitPreferred.join(', ')}.`)
  if (expScore >= 25) pros.push(expNote)
  if (candidate.current?.title) {
    pros.push(`Currently ${candidate.current.title}${candidate.current.company ? ` at ${candidate.current.company}` : ''}.`)
  }
  if (candidate.notice_period_days === 0) pros.push('Available immediately.')

  if (missRequired.length) {
    cons.push(`No evidence of: ${missRequired.join(', ')}.`)
  }
  if (expScore < 25) cons.push(expNote)
  if (candidate.notice_period_days > 60) {
    cons.push(`Notice period is ${candidate.notice_period_days} days.`)
  }
  if ((candidate.parsed?.confidence ?? 1) < 0.6) {
    cons.push('The resume parsed poorly — these findings are low confidence.')
  }
  if (!pros.length) pros.push('Nothing in the resume matched this role.')
  if (!cons.length) cons.push('No material gaps found against the stated requirements.')

  return {
    match_percent: matchPercent,
    breakdown: {
      required_skills: Math.round(skillScore),
      preferred_skills: Math.round(preferredScore),
      experience: Math.round(expScore),
      jd_relevance: Math.round(contextScore),
    },
    matched_skills: hitRequired,
    missing_skills: missRequired,
    pros,
    cons,
    model: { name: 'local-heuristic', prompt_version: 'screen-2026.09.1' },
  }
}

// ---------------------------------------------------------------------------
// AI #2a · Question generation (§11.4 — generate-then-edit beats configure)
// ---------------------------------------------------------------------------

const BEHAVIOURAL_BANK = [
  { text: 'Tell me about a deadline you missed. What happened, and what did you change afterwards?', competency: 'ownership', weight: 2 },
  { text: 'Describe a disagreement with a colleague about a technical decision. How did it end?', competency: 'communication', weight: 1 },
  { text: 'What is the hardest problem you have debugged? Walk me through how you found it.', competency: 'technical', weight: 2 },
  { text: 'Tell me about something you shipped that you are not proud of.', competency: 'ownership', weight: 1 },
]

// Most open roles are sales roles, and a sales candidate asked "what is the
// hardest problem you have debugged?" learns only that the interview was not
// written for them.
const SALES_BEHAVIOURAL_BANK = [
  { text: 'Tell me about a quarter where you missed your target. What happened, and what did you change?', competency: 'ownership', weight: 2 },
  { text: 'Walk me through how you win back a customer or agent who has stopped doing business with you.', competency: 'communication', weight: 2 },
  { text: 'How do you plan your week in the field — how many meetings, and how do you decide who to see first?', competency: 'experience', weight: 1 },
  { text: 'Tell me about the biggest deal or account you closed. What made it work?', competency: 'experience', weight: 2 },
]

function skillQuestion(skill) {
  const specific = {
    'Agency Channel': 'How have you recruited and activated insurance agents? Walk me through your numbers — how many recruited, how many active after six months.',
    Insurance: 'Explain a product you have sold to a customer who did not understand insurance. How did you explain it?',
    Bancassurance: 'How do you get bank branch staff to prioritise your product over everything else they sell?',
    'Lead Generation': 'Where do your leads actually come from, and what is your conversion rate from lead to closure?',
    Negotiation: 'Tell me about a negotiation where the customer pushed hard on price. What did you give, and what did you hold?',
    Salesforce: 'How have you used Salesforce day to day — what did you track, and how did it change what you did?',
    CRM: 'How did you use your CRM to decide which leads to follow up first?',
    'Field Sales': 'Describe a typical day in the field in your current role, with numbers.',
    'SQL Server': 'A query that ran fine in testing takes 40 seconds in production. Walk me through how you find out why.',
    'Entity Framework': 'How do you deal with N+1 queries in Entity Framework? Be specific about what you actually do.',
    React: 'When does a React component re-render more than it should, and how have you tracked that down?',
    Docker: 'Walk me through what happens between your Dockerfile and a running container in production.',
    Kubernetes: 'A pod is in CrashLoopBackOff. What do you check, in what order?',
    MongoDB: 'How do you decide between embedding a document and referencing it?',
    Python: 'Where have you hit the GIL in real work, and what did you do about it?',
    Kafka: 'How do you handle a consumer that falls behind the producer?',
    AWS: 'Describe the AWS setup of something you have actually run in production.',
    'System Design': 'Design the system you would build to screen 10,000 resumes a day. Talk me through the bottlenecks.',
  }
  return {
    text: specific[skill] ?? `Tell me about your hands-on work with ${skill}. What have you actually built with it?`,
    competency: 'technical',
    weight: 3,
    expected_points: [skill],
  }
}

/**
 * Generate a question set from the JD, the required skills, and this
 * candidate's resume. Persisted as the job's template on first use, so the
 * recruiter ends up with something editable they never had to write.
 */
export async function generateQuestions({ job, candidate, count = 8 }) {
  await delay(500 + Math.random() * 600)

  const questions = []
  let n = 0
  const add = (q) => questions.push({ id: `q${++n}`, type: 'open', must_ask: false, ...q })

  add({
    text: `Walk me through your experience as it relates to the ${job.title} role — what have you owned end to end?`,
    competency: 'experience',
    weight: 3,
    must_ask: true,
    follow_up_hint: 'Probe for their specific contribution, not the team\'s.',
  })

  // One question per required skill, highest-signal first, capped so the set
  // stays balanced rather than becoming a vocabulary quiz.
  // The primary skill goes first and is always asked — it is the one the
  // recruiter said matters most.
  const required = job.skills_required ?? []
  const ordered = job.primary_skill
    ? [job.primary_skill, ...required.filter((s) => s !== job.primary_skill)]
    : required
  const skills = ordered.slice(0, Math.max(1, count - 4))
  for (const skill of skills) {
    add({
      ...skillQuestion(skill),
      type: 'technical',
      must_ask: skills.indexOf(skill) < (job.primary_skill ? 1 : 2),
      primary: skill === job.primary_skill || undefined,
    })
  }

  // One question grounded in *this* candidate's resume. This is what makes the
  // interview feel like it was prepared rather than generated.
  const theirSkills = (candidate?.parsed?.skills ?? []).filter(
    (s) => !(job.skills_required ?? []).includes(s),
  )
  if (theirSkills.length) {
    add({
      text: `Your resume mentions ${theirSkills.slice(0, 2).join(' and ')}. Where did you use ${theirSkills[0]}, and what did it solve?`,
      competency: 'experience',
      weight: 2,
      expected_points: theirSkills.slice(0, 2),
    })
  }

  const bank = job.screening_profile?.hiring_type === 'Sales' ? SALES_BEHAVIOURAL_BANK : BEHAVIOURAL_BANK
  for (const b of bank) {
    if (questions.length >= count) break
    add({ ...b, type: 'behavioural' })
  }

  return questions.slice(0, count)
}

// ---------------------------------------------------------------------------
// AI #2b · Conducting the interview
// ---------------------------------------------------------------------------

/** How substantial an answer is, 0–1. The one measurement everything rests on. */
function substance(answer, question) {
  const words = tokens(answer)
  const unique = new Set(words)

  // Length, saturating at ~90 words. Past that, more words stop being more signal.
  const lengthScore = Math.min(1, words.length / 90)

  // Did they hit the points the question was looking for?
  const expected = question.expected_points ?? []
  const hit = expected.filter((p) => skillPresent(p, answer))
  const coverage = expected.length ? hit.length / expected.length : null

  // Concrete beats abstract: numbers, first person, named specifics.
  const concrete = [
    /\b\d+\b/.test(answer),
    /\bi\s+(built|wrote|led|owned|shipped|fixed|designed|migrated|reduced)\b/i.test(answer),
    /\b(because|so that|which meant|the reason)\b/i.test(answer),
    unique.size > 25,
  ].filter(Boolean).length / 4

  const parts = coverage == null
    ? [lengthScore * 0.6, concrete * 0.4]
    : [lengthScore * 0.35, coverage * 0.4, concrete * 0.25]

  return {
    value: parts.reduce((a, b) => a + b, 0),
    words: words.length,
    coverage,
    hit,
    missed: expected.filter((p) => !hit.includes(p)),
  }
}

/**
 * Decide whether to follow up, and on what.
 *
 * Strictness drives this: lenient rarely probes, moderate probes a vague
 * answer once, strict probes everything for specifics (§12.4).
 */
export async function nextFollowUp({ question, answer, strictness, alreadyAsked }) {
  await delay(200 + Math.random() * 300)

  const limitReached = alreadyAsked >= 1
  if (limitReached) return null

  const s = substance(answer, question)
  const policy = STRICTNESS[strictness] ?? STRICTNESS.moderate

  const shouldProbe =
    policy.followUps === 'always' ||
    (policy.followUps === 'when vague' && s.value < 0.55) ||
    (policy.followUps === 'rarely' && s.value < 0.25)

  if (!shouldProbe) return null

  if (s.missed.length) {
    return `You did not touch on ${s.missed.slice(0, 2).join(' or ')}. Can you say more about that?`
  }
  if (s.words < 30) {
    return 'That was quite short — can you give me a concrete example?'
  }
  if (!/\bi\s+/i.test(answer)) {
    return 'What part of that was yours specifically, rather than the team\'s?'
  }
  return question.follow_up_hint
    ? `${question.follow_up_hint.replace(/^Probe for /i, 'Tell me more about ')}`
    : 'Can you walk me through the detail of how you did that?'
}

// ---------------------------------------------------------------------------
// AI #2c · Scoring and the report (§14)
// ---------------------------------------------------------------------------

/** Pull the sentence that best justifies a score. Evidence must be VERBATIM. */
function bestQuote(answer) {
  const sentences = String(answer)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)
  if (!sentences.length) return String(answer).trim().slice(0, 160)
  const scored = sentences.map((s) => ({
    s,
    score: tokens(s).length + (/\b\d+\b/.test(s) ? 5 : 0) + (/\bi\s+\w+ed\b/i.test(s) ? 5 : 0),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored[0].s.slice(0, 220)
}

/**
 * Score a completed session against its own FROZEN plan.
 *
 * Note what this reads: `session.plan`, never the live job or template. That is
 * the freeze doing its job — the report is reproducible even if the job was
 * edited or deleted an hour later.
 */
export async function scoreSession({ session }) {
  await delay(900 + Math.random() * 900)

  const { plan } = session
  const answersByQuestion = new Map()
  for (const turn of session.turns) {
    if (turn.role !== 'candidate') continue
    const prev = answersByQuestion.get(turn.question_id) ?? []
    answersByQuestion.set(turn.question_id, [...prev, turn.text])
  }

  const perQuestion = []
  const byCompetency = new Map()

  for (const q of plan.questions) {
    const answers = answersByQuestion.get(q.id) ?? []
    const joined = answers.join(' ')
    const answered = joined.trim().length > 0

    const s = answered ? substance(joined, q) : { value: 0, words: 0, missed: q.expected_points ?? [], hit: [] }

    // 0–5, calibrated by strictness. Strict does not scale the final number —
    // it moves the rubric, which is what keeps scores comparable (§12.4).
    const calibration = { lenient: 1.15, moderate: 1.0, strict: 0.85 }[plan.rules.strictness] ?? 1
    const score = answered ? Math.max(0, Math.min(5, Math.round(s.value * 5 * calibration))) : 0

    const rationale = !answered
      ? 'Not answered.'
      : score >= 4
        ? `Specific and first-person${s.hit.length ? `; covered ${s.hit.join(', ')}` : ''}.`
        : score >= 2
          ? `Partially answered${s.missed.length ? `; did not cover ${s.missed.join(', ')}` : '; stayed general'}.`
          : 'Thin — little concrete detail.'

    perQuestion.push({
      question_id: q.id,
      question: q.text,
      competency: q.competency,
      weight: q.weight ?? 1,
      answered,
      score,
      max: 5,
      rationale,
      // The evidence panel. A number with no quote behind it invites a
      // recruiter to stop thinking, and cannot be defended if a candidate
      // disputes the outcome.
      evidence: answered ? bestQuote(joined) : null,
      covered_points: s.hit,
      missed_points: s.missed,
      words: s.words,
    })

    const key = q.competency ?? 'technical'
    const bucket = byCompetency.get(key) ?? { total: 0, weight: 0, evidence: [] }
    bucket.total += score * (q.weight ?? 1)
    bucket.weight += 5 * (q.weight ?? 1)
    if (answered && score >= 3) bucket.evidence.push(bestQuote(joined))
    if (answered && score <= 1) bucket.evidence.push(`Weak on: "${q.text}"`)
    byCompetency.set(key, bucket)
  }

  const competencies = plan.scoring.competencies.map((c) => {
    const b = byCompetency.get(c.key)
    return {
      key: c.key,
      label: c.label,
      weight: c.weight,
      score: b && b.weight ? Math.round((b.total / b.weight) * 100) : null,
      evidence: b?.evidence.slice(0, 3) ?? [],
    }
  })

  // The overall score is computed IN CODE, from the per-question scores — never
  // asked of the model. A model asked for a summary number will produce one
  // that does not follow from its own per-answer judgements.
  const scored = competencies.filter((c) => c.score != null)
  const totalWeight = scored.reduce((s, c) => s + c.weight, 0)
  const overall = totalWeight
    ? Math.round(scored.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight)
    : 0

  const threshold = plan.scoring.shortlist_threshold
  const recommendation =
    overall >= threshold ? 'shortlist' : overall >= threshold - 10 ? 'hold' : 'reject'

  const answeredCount = perQuestion.filter((p) => p.answered).length
  const confidence =
    answeredCount === 0 ? 'low'
    : answeredCount < plan.questions.length * 0.6 ? 'low'
    : answeredCount < plan.questions.length ? 'medium'
    : 'high'

  const strong = perQuestion.filter((p) => p.score >= 4)
  const weak = perQuestion.filter((p) => p.answered && p.score <= 2)

  const strengths = strong.slice(0, 3).map((p) => `${labelFor(competencies, p.competency)}: ${p.rationale}`)
  const concerns = weak.slice(0, 3).map((p) => `${labelFor(competencies, p.competency)}: ${p.rationale}`)
  if (answeredCount < plan.questions.length) {
    concerns.push(`${plan.questions.length - answeredCount} of ${plan.questions.length} questions went unanswered.`)
  }

  const allMissed = [...new Set(perQuestion.flatMap((p) => p.missed_points))]
  const followUps = allMissed.slice(0, 3).map((m) => `Probe ${m} in the human round — it did not come up.`)
  if (weak.length) followUps.push(`Re-ask: "${weak[0].question}"`)

  const totalWords = perQuestion.reduce((s, p) => s + p.words, 0)
  const durationMin = Math.max(1, (session.duration_seconds ?? 600) / 60)

  // Per-skill scores: every question that was looking for a skill contributes
  // to that skill. The primary skill is listed first.
  const ctx = plan.job_context ?? {}
  const skillNames = [...new Set([ctx.primary_skill, ...(ctx.skills_required ?? [])].filter(Boolean))]
  const skills = skillNames.map((skill) => {
    const qs = perQuestion.filter((p) => {
      const q = plan.questions.find((x) => x.id === p.question_id)
      return (q?.expected_points ?? []).includes(skill)
    })
    const asked = qs.filter((p) => p.answered)
    return {
      skill,
      primary: skill === ctx.primary_skill,
      score: asked.length ? Math.round((asked.reduce((a, p) => a + p.score, 0) / (asked.length * 5)) * 100) : null,
      out_of_10: asked.length ? Math.round((asked.reduce((a, p) => a + p.score, 0) / (asked.length * 5)) * 10) : null,
      questions: qs.length,
    }
  })

  const communication = communicationSignals(
    session.turns.filter((t) => t.role === 'candidate').map((t) => t.text),
  )

  return {
    conducted_in: plan.rules.language,
    overall_score: overall,
    recommendation,
    confidence,
    headline: headlineFor(overall, threshold, competencies),
    competencies,
    skills,
    communication,
    per_question: perQuestion,
    strengths: strengths.length ? strengths : ['Nothing stood out as a clear strength.'],
    concerns: concerns.length ? concerns : ['No material concerns raised by the transcript.'],
    follow_up_questions: followUps.length ? followUps : ['Nothing specific — run a standard technical round.'],
    signals: {
      speech: {
        words_per_minute: Math.round(totalWords / durationMin),
        avg_answer_words: answeredCount ? Math.round(totalWords / answeredCount) : 0,
      },
      coverage: { questions_answered: answeredCount, questions_planned: plan.questions.length },
    },
    model: { name: 'local-heuristic', prompt_version: 'interview-eval-2026.09.1' },
    generated_at: new Date().toISOString(),
  }
}

/**
 * Fluency, confidence and clarity from the answers themselves — the three a
 * sales hiring manager asks about first. Heuristic: fluency is sustained,
 * connected answers; confidence is the absence of hedging; clarity is
 * sentences a listener can follow. Each 0–100.
 */
const HEDGES = /\b(maybe|i think|i guess|not sure|probably|kind of|sort of|i don't know|perhaps|somewhat|basically)\b/gi

export function communicationSignals(answers) {
  const text = answers.join(' ').trim()
  if (!text) return null
  const words = text.split(/\s+/).filter(Boolean)
  const sentences = text.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 0)
  const avgAnswer = words.length / Math.max(1, answers.length)
  const avgSentence = words.length / Math.max(1, sentences.length)
  const connectors = (text.match(/\b(because|so|then|after|which|when|therefore|however|first|finally)\b/gi) ?? []).length
  const hedges = (text.match(HEDGES) ?? []).length

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)))
  const fluency = clamp(Math.min(1, avgAnswer / 70) * 70 + Math.min(1, connectors / Math.max(1, answers.length * 2)) * 30)
  const confidence = clamp(100 - (hedges / Math.max(1, words.length / 40)) * 25)
  // 12–25 words a sentence is easy to follow; far outside that is not.
  const clarity = clamp(100 - Math.max(0, Math.abs(avgSentence - 18) - 7) * 5)

  return {
    fluency, confidence, clarity,
    hedges,
    avg_sentence_words: Math.round(avgSentence),
  }
}

function labelFor(competencies, key) {
  return competencies.find((c) => c.key === key)?.label ?? key ?? 'General'
}

function headlineFor(overall, threshold, competencies) {
  const ranked = competencies.filter((c) => c.score != null).sort((a, b) => b.score - a.score)
  const best = ranked[0]
  const worst = ranked[ranked.length - 1]
  if (!best) return 'Not enough was answered to form a view.'
  if (overall >= threshold) {
    return `Strong on ${best.label.toLowerCase()}${worst && worst.key !== best.key ? `; thinner on ${worst.label.toLowerCase()}` : ''}.`
  }
  if (overall >= threshold - 10) {
    return `Borderline — ${best.label.toLowerCase()} holds up, ${worst?.label.toLowerCase() ?? 'the rest'} does not.`
  }
  return `Below the bar for this role, mainly on ${worst?.label.toLowerCase() ?? 'the core requirements'}.`
}

/**
 * Guardrails, layer 2 (§12.6). Every question is screened before it is asked —
 * including ones the recruiter typed by hand. Not distrust: a question that
 * reads as innocuous in a form becomes a discrimination exposure when an AI
 * asks it of 200 people and the transcripts are retained.
 */
const BLOCKED = [
  { re: /\b(married|marriage|spouse|husband|wife|children|kids|pregnan|family plan)\b/i, why: 'marital or family status' },
  { re: /\b(religion|caste|church|temple|mosque|hindu|muslim|christian|sikh)\b/i, why: 'religion or caste' },
  { re: /\b(how old are you|your age|date of birth|born in \d{4})\b/i, why: 'age' },
  { re: /\b(disability|disabled|medical condition|health issue|illness)\b/i, why: 'health or disability' },
  { re: /\b(pregnant|maternity|paternity leave plans)\b/i, why: 'pregnancy' },
  { re: /\b(gender|male or female|sexual orientation)\b/i, why: 'gender or orientation' },
  { re: /\b(native place|mother tongue|which state are you from|settle in \w+ long)\b/i, why: 'regional or linguistic origin' },
  { re: /\b(political|which party|vote)\b/i, why: 'political affiliation' },
]

export function screenQuestion(text) {
  for (const rule of BLOCKED) {
    if (rule.re.test(text)) {
      return { ok: false, reason: `This asks about ${rule.why}, which cannot be a hiring criterion. Rephrase it around the work itself.` }
    }
  }
  return { ok: true }
}
