// The pipeline (§5 of the system design).
//
// The load-bearing rule: **the recruiter moves the stage, always.** The system
// owns interview *session* state (invited / in_progress / completed) and
// displays it next to the stage, but it never advances the stage on its own.
// The two exceptions the design allows are recorded here as `by: 'system'`
// transitions that only the interview engine performs.

export const STAGES = {
  sourced:              { label: 'Sourced',        group: 'source',    tone: 'neutral' },
  screened:             { label: 'Screened',       group: 'screen',    tone: 'info' },
  interest_sent:        { label: 'Interest sent',  group: 'engage',    tone: 'info' },
  interested:           { label: 'Interested',     group: 'engage',    tone: 'good' },
  not_interested:       { label: 'Not interested', group: 'closed',    tone: 'bad',  terminal: true },
  invited:              { label: 'Invited',        group: 'interview', tone: 'info' },
  interview_in_progress:{ label: 'In progress',    group: 'interview', tone: 'warn' },
  interview_completed:  { label: 'Interviewed',    group: 'interview', tone: 'good' },
  abandoned:            { label: 'Abandoned',      group: 'interview', tone: 'warn' },
  shortlisted:          { label: 'Shortlisted',    group: 'decide',    tone: 'good' },
  human_round:          { label: 'Face-to-face round', group: 'decide', tone: 'good' },
  on_hold:              { label: 'On hold',        group: 'decide',    tone: 'warn' },
  // Offer, onboarding and BGV happen in Darwin, not here. "Selected" is the
  // hand-off: ProHire's job ends when the candidate is passed on.
  selected:             { label: 'Selected → Darwin', group: 'closed', tone: 'good', terminal: true },
  rejected:             { label: 'Rejected',       group: 'closed',    tone: 'bad',  terminal: true },
  withdrawn:            { label: 'Withdrawn',      group: 'closed',    tone: 'neutral', terminal: true },
}

export const STAGE_ORDER = Object.keys(STAGES)

/**
 * Which stages a recruiter may move an application to by hand.
 *
 * Deliberately permissive rather than a strict state machine: a recruiter who
 * knows a candidate is interested can go straight from `sourced` to `invited`,
 * and re-inviting an abandoned session is a first-class action, not data
 * repair. What is *not* here is anything the system owns —
 * `interview_in_progress` and `interview_completed` never appear, because only
 * the interview itself can produce them.
 */
const SYSTEM_OWNED = ['interview_in_progress', 'interview_completed']

export function allowedNextStages(current) {
  return STAGE_ORDER.filter(
    (s) => s !== current && !SYSTEM_OWNED.includes(s),
  )
}

export function isTerminal(stage) {
  return Boolean(STAGES[stage]?.terminal)
}

export function stageLabel(stage) {
  return STAGES[stage]?.label ?? stage
}

export function stageTone(stage) {
  return STAGES[stage]?.tone ?? 'neutral'
}

/** The funnel, in the order a recruiter reads it. */
export const FUNNEL = [
  { key: 'sourced',             label: 'Sourced' },
  { key: 'screened',            label: 'Screened' },
  { key: 'invited',             label: 'Invited' },
  { key: 'interview_completed', label: 'Interviewed' },
  { key: 'shortlisted',         label: 'Shortlisted' },
  { key: 'selected',            label: 'Selected' },
]
