import { useEffect, useState } from 'react'

import { Modal, Field, Select, Badge } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import EmailCompose from '../../../components/EmailCompose.jsx'
import {
  resolveForApplication, invite, ensureJobQuestions, ensureQualification,
  setCandidateOverride, clearCandidateOverride,
} from '../../../services/interviews.js'
import { getCandidate } from '../../../services/candidates.js'
import { screenQuestion } from '../../../domain/ai.js'
import { STRICTNESS, ASSESSMENT_TYPES, INTERVIEW_MODES } from '../../../domain/resolvePlan.js'
import { languageOptions, interviewLanguagesFor, ALLOWED_DURATIONS } from '../../../domain/locations.js'
import { newQuestionId } from '../../../lib/ids.js'
import { inviteVars } from '../candidates/inviteVars.js'

/**
 * Send an AI interview to ONE candidate.
 *
 * Every setting here is for this candidate only: two people on the same job
 * can get different languages, lengths, strictness and questions. Nothing is
 * locked once a job is set up — the job only provides the starting point.
 */
export default function InviteDialog({ application, onClose }) {
  const toast = useToast()
  const [ready, setReady] = useState(false)
  const [adhoc, setAdhoc] = useState({})
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [customising, setCustomising] = useState(false)
  // Bumping this re-derives the plan after the candidate override is written.
  const [, setRevision] = useState(0)

  // No questions yet? Generate them from the JD and this candidate's resume,
  // and save them as the job's set so they can be edited later.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await ensureJobQuestions(application.job_id, application.candidate_id)
      ensureQualification(application.job_id)
      if (!cancelled) setReady(true)
    })()
    return () => { cancelled = true }
  }, [application.job_id, application.candidate_id])

  const adhocLayer = Object.keys(adhoc).length ? { rules: adhoc } : null
  const resolved = ready ? resolveForApplication(application._id, adhocLayer) : null

  if (!ready || !resolved) {
    return (
      <Modal title="Preparing the interview" onClose={onClose}>
        <div className="row"><span className="spin" /> Preparing questions from the job description and this resume…</div>
      </Modal>
    )
  }

  const { plan, problems, job } = resolved
  const candidate = getCandidate(application.candidate_id)

  if (result) {
    return (
      <EmailCompose
        title={`Send the interview to ${application.candidate_name}`}
        to={candidate.email} phone={candidate.phone}
        templateKey="interview_invite"
        vars={{ candidate_name: candidate.full_name, ...inviteVars(application, result.session, result.url) }}
        note={<>Interview created. Send this email (or WhatsApp) to the candidate. <a href={result.url} target="_blank" rel="noreferrer">Preview the interview</a></>}
        onClose={onClose}
      />
    )
  }

  const set = (patch) => setAdhoc((a) => ({ ...a, ...patch }))
  const setProctoring = (patch) => setAdhoc((a) => ({ ...a, proctoring: { ...(a.proctoring ?? {}), ...patch } }))
  const type = plan.rules.assessment_type
  const spokenLanguages = interviewLanguagesFor(candidate)
  const p = plan.rules.proctoring ?? {}

  async function send() {
    setSending(true)
    try {
      const out = await invite(application._id, adhocLayer)
      setResult(out)
      toast(`Interview ready for ${application.candidate_name}.`, 'good')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      wide
      title={`AI interview · ${application.candidate_name} · ${job.reference}`}
      onClose={onClose}
      footer={
        <>
          <span className="small muted" style={{ marginRight: 'auto' }}>These settings apply to this candidate only.</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={send} disabled={sending || problems.length > 0}>
            {sending ? 'Creating…' : 'Create interview & write email'}
          </button>
        </>
      }
    >
      {problems.length > 0 && (
        <div className="note bad mb">
          <strong>This can’t be sent yet:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {problems.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}

      <div className="grid c3">
        <Field label="What to send">
          <Select
            options={Object.entries(ASSESSMENT_TYPES).map(([k, v]) => ({ value: k, label: v.label }))}
            value={type} onChange={(v) => set({ assessment_type: v })}
          />
        </Field>
        <Field
          label="Language"
          hint={spokenLanguages.length > 1 ? `Their resume lists: ${spokenLanguages.map((l) => l.resume).join(', ')}` : `Default: ${plan.provenance.language}`}
        >
          <Select options={languageOptions()} value={plan.rules.language} onChange={(v) => set({ language: v })} />
          {spokenLanguages.filter((l) => l.code !== plan.rules.language).length > 0 && (
            <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
              {spokenLanguages.filter((l) => l.code !== plan.rules.language).map((l) => (
                <button key={l.code} className="chip" onClick={() => set({ language: l.code })}>Use {l.resume}</button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Format" hint={INTERVIEW_MODES[plan.rules.mode]?.detail}>
          <Select
            options={Object.entries(INTERVIEW_MODES).map(([k, v]) => ({ value: k, label: v.label }))}
            value={plan.rules.mode} onChange={(v) => set({ mode: v })} disabled={type === 'qualification'}
          />
        </Field>
      </div>

      {type !== 'qualification' && (
        <div className="grid c3">
          <Field label="Strictness" hint={STRICTNESS[plan.rules.strictness].tone}>
            <Select
              options={Object.entries(STRICTNESS).map(([k, v]) => ({ value: k, label: `${v.label} — pass at ${v.threshold}` }))}
              value={plan.rules.strictness} onChange={(v) => set({ strictness: v })}
            />
          </Field>
          <Field label="Length">
            <Select
              options={ALLOWED_DURATIONS.map((d) => ({ value: String(d), label: `${d} minutes` }))}
              value={String(plan.rules.duration_minutes)}
              onChange={(v) => set({ duration_minutes: Number(v), light_mode: false })}
            />
          </Field>
          <Field label="Leaving the tab">
            <Select
              options={[
                { value: 'end3', label: 'Warn 3×, then end' },
                { value: 'end1', label: 'Warn 1×, then end' },
                { value: 'warn', label: 'Warn only, never end' },
                { value: 'off', label: 'Don’t check' },
              ]}
              value={!p.tab_switch_warning ? 'off' : !p.auto_terminate ? 'warn' : p.max_tab_switches === 1 ? 'end1' : 'end3'}
              onChange={(v) => setProctoring({
                off: { tab_switch_warning: false, auto_terminate: false },
                warn: { tab_switch_warning: true, auto_terminate: false },
                end1: { tab_switch_warning: true, auto_terminate: true, max_tab_switches: 1 },
                end3: { tab_switch_warning: true, auto_terminate: true, max_tab_switches: 3 },
              }[v])}
            />
          </Field>
        </div>
      )}

      {type !== 'qualification' && (
        <label className="check mb">
          <input type="checkbox" checked={plan.rules.light_mode} onChange={(e) => set({ light_mode: e.target.checked })} />
          <span>
            Light mode — 15 minutes
            <span className="hint" style={{ display: 'block' }}>At most 5 questions. Good for a first round.</span>
          </span>
        </label>
      )}

      {type !== 'interview' && (
        <div className="note mb">
          <strong>Questionnaire:</strong> {plan.qualification.length} question{plan.qualification.length === 1 ? '' : 's'}
          {plan.qualification.length > 0 && <> — {plan.qualification.map((q) => q.text).slice(0, 3).join(' · ')}{plan.qualification.length > 3 ? ' …' : ''}</>}
          <div className="small muted" style={{ marginTop: 4 }}>Edit these under the job’s Interview setup tab.</div>
        </div>
      )}

      {type !== 'qualification' && (
        <>
          <div className="between" style={{ marginTop: 6, marginBottom: 8 }}>
            <h4 style={{ margin: 0 }}>
              {plan.questions.length} interview question{plan.questions.length === 1 ? '' : 's'}
              {plan.dropped.length > 0 && <span className="small muted"> · {plan.dropped.length} left out to fit {plan.rules.duration_minutes} min</span>}
            </h4>
            <button className="btn sm" onClick={() => setCustomising((c) => !c)}>
              {customising ? 'Done' : 'Change questions for this candidate'}
            </button>
          </div>

          {customising && (
            <Customise application={application} plan={plan} onChange={() => setRevision((r) => r + 1)} />
          )}

          <ol style={{ paddingLeft: 20, margin: 0 }}>
            {plan.questions.map((q) => (
              <li key={q.id} style={{ marginBottom: 8 }}>
                <div>{q.text}</div>
                <div className="row small dim" style={{ gap: 6, marginTop: 2 }}>
                  <span className="chip">{q.type}</span>
                  {q.primary && <Badge tone="accent">primary skill</Badge>}
                  {q.must_ask && <Badge tone="accent">always asked</Badge>}
                </div>
              </li>
            ))}
          </ol>
          <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
            With no questions of your own, {plan.persona.name} asks about the job description and the
            candidate’s resume.
          </p>
        </>
      )}
    </Modal>
  )
}

/** This candidate's own questions — added to, or removed from, the job's set. */
function Customise({ application, plan, onChange }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const override = application.interview_override

  const addQuestion = () => {
    const clean = text.trim()
    if (!clean) return
    // Every question is checked before it can be asked — including typed ones.
    const check = screenQuestion(clean)
    if (!check.ok) return toast(check.reason, 'bad')

    const ops = [...(override?.question_ops ?? []), {
      op: 'add',
      question: { id: newQuestionId('c'), text: clean, type: 'open', competency: 'experience', weight: 2, must_ask: true },
    }]
    setCandidateOverride(application._id, { ...override, question_ops: ops })
    setText('')
    onChange()
  }

  const removeQuestion = (id) => {
    const ops = [...(override?.question_ops ?? []), { op: 'remove', question_id: id }]
    setCandidateOverride(application._id, { ...override, question_ops: ops })
    onChange()
  }

  const added = new Set((override?.question_ops ?? []).filter((o) => o.op === 'add').map((o) => o.question.id))

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-body">
        <Field label="Add a question for this candidate" hint="Press Enter to add. Questions about age, religion, marital status and similar are blocked.">
          <div className="row">
            <input
              type="text" value={text} onChange={(e) => setText(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addQuestion())}
              placeholder="You were at Horizon for 3 years — why are you looking to move?"
            />
            <button className="btn" onClick={addQuestion}>Add</button>
          </div>
        </Field>
        <div className="col small" style={{ gap: 4 }}>
          {plan.questions.map((q) => (
            <div key={q.id} className="between">
              <span className="truncate" style={{ maxWidth: '85%' }}>{added.has(q.id) && <Badge tone="accent">added</Badge>} {q.text}</span>
              <button className="btn ghost sm" onClick={() => removeQuestion(q.id)} aria-label="Remove question">✕</button>
            </div>
          ))}
        </div>
        {override?.question_ops?.length > 0 && (
          <button className="btn ghost sm mt" onClick={() => { clearCandidateOverride(application._id); onChange() }}>
            Undo all changes for this candidate
          </button>
        )}
      </div>
    </div>
  )
}
