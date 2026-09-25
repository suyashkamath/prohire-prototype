// The questionnaire ("qualification") — short typed questions a candidate
// answers from their phone, before or instead of the AI interview.
//
// Each question can carry a KNOCKOUT: an answer that means "not for this role"
// (e.g. "Are you okay with field travel?" → No). A knockout is flagged in the
// report; it never rejects anyone on its own. The recruiter decides.

import { newQuestionId } from '../lib/ids.js'

export const QUALIFICATION_KINDS = {
  yes_no: { label: 'Yes / No' },
  number: { label: 'Number' },
  text:   { label: 'Short text' },
  choice: { label: 'Pick one' },
}

/** A sensible starting set, generated from the job. Edit freely. */
export function defaultQualification(job) {
  const qs = [
    { text: 'What is your current CTC (in LPA)?', kind: 'number' },
    { text: 'What is your expected CTC (in LPA)?', kind: 'number' },
    { text: 'What is your notice period (in days)?', kind: 'number' },
    {
      text: `This role is based in ${job?.location?.city ?? 'our office'}. Are you okay working from there?`,
      kind: 'yes_no',
      knockout: { answer: 'no' },
    },
  ]
  if (job?.primary_skill) {
    qs.push({
      text: `How many years of hands-on experience do you have in ${job.primary_skill}?`,
      kind: 'number',
      knockout: job.primary_skill_min_years ? { below: job.primary_skill_min_years } : undefined,
    })
  }
  return qs.map((q) => ({ id: newQuestionId('k'), ...q }))
}

/** Evaluate one set of answers. Pure, so the report and the tests share it. */
export function evaluateQualification(questions = [], answers = {}) {
  const rows = questions.map((q) => {
    const raw = answers[q.id]
    const answered = raw != null && String(raw).trim() !== ''
    let knocked = false
    if (answered && q.knockout) {
      if (q.knockout.answer != null) knocked = String(raw).toLowerCase() === String(q.knockout.answer).toLowerCase()
      if (q.knockout.below != null) knocked = Number(raw) < Number(q.knockout.below)
      if (q.knockout.above != null) knocked = Number(raw) > Number(q.knockout.above)
    }
    return { id: q.id, text: q.text, kind: q.kind, answer: answered ? raw : null, answered, knocked }
  })
  return {
    rows,
    answered: rows.filter((r) => r.answered).length,
    total: rows.length,
    knockouts: rows.filter((r) => r.knocked).map((r) => r.text),
  }
}

export function describeKnockout(q) {
  if (!q.knockout) return null
  if (q.knockout.answer != null) return `flag if "${q.knockout.answer}"`
  if (q.knockout.below != null) return `flag if below ${q.knockout.below}`
  if (q.knockout.above != null) return `flag if above ${q.knockout.above}`
  return null
}
