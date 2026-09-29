import { useEffect, useState } from 'react'

import { Modal, Field, Select } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { resolveForApplication, invite, ensureJobQuestions } from '../../../services/interviews.js'
import { botStatus, botUrl } from '../../../services/interviewBot.js'
import { getCandidate } from '../../../services/candidates.js'
import { screenQuestion } from '../../../domain/ai.js'
import { STRICTNESS, INTERVIEW_MODES, INTRO_QUESTION, isIntroQuestion, questionsThatFit } from '../../../domain/resolvePlan.js'
import { BOT_LANGUAGES, DEFAULT_ANSWER_PAUSE } from '../../../domain/interviewBot.js'
import { languageOptions, interviewLanguagesFor, ALLOWED_DURATIONS } from '../../../domain/locations.js'
import { newQuestionId } from '../../../lib/ids.js'
import InviteEmail from './InviteEmail.jsx'

const TAB_RULES = [
  { value: 'end3', label: 'Warn 3×, then end' },
  { value: 'end1', label: 'Warn 1×, then end' },
  { value: 'warn', label: 'Warn only, never end' },
  { value: 'off', label: 'Don’t check' },
]
const TAB_PATCH = {
  off: { tab_switch_warning: false, auto_terminate: false },
  warn: { tab_switch_warning: true, auto_terminate: false },
  end1: { tab_switch_warning: true, auto_terminate: true, max_tab_switches: 1 },
  end3: { tab_switch_warning: true, auto_terminate: true, max_tab_switches: 3 },
}
const tabRule = (p) => (!p.tab_switch_warning ? 'off' : !p.auto_terminate ? 'warn' : p.max_tab_switches === 1 ? 'end1' : 'end3')
const PAUSES = [1.5, 2, 2.5, 3, 4, 5]

/**
 * Send the AI screening round to ONE candidate.
 *
 * The screening round is always the AI video interview: a live spoken
 * interview with the AI interviewer, on camera and recorded, run by the
 * InterviewBot server. There is no other format to choose here.
 *
 * The candidate's details come from their profile — nothing to type. The
 * recruiter decides the questions and how the interviewer behaves, for this
 * candidate only; the job only provides the starting point. Nothing opens the
 * interview here: the link is emailed to the candidate.
 */
export default function InviteDialog({ application, onClose }) {
  const toast = useToast()
  const [ready, setReady] = useState(false)
  const [adhoc, setAdhoc] = useState({})
  // This invite's own question list. null = the job's questions.
  const [questions, setQuestions] = useState(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [server, setServer] = useState(null)

  // No questions yet? Generate them from the JD and this candidate's resume,
  // and save them as the job's set so they can be edited later.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await ensureJobQuestions(application.job_id, application.candidate_id)
      if (!cancelled) setReady(true)
    })()
    return () => { cancelled = true }
  }, [application.job_id, application.candidate_id])

  useEffect(() => {
    let live = true
    botStatus().then((s) => { if (live) setServer(s) })
    return () => { live = false }
  }, [])

  // Always the AI video interview, the interview only, in English or Hindi: a
  // job that defaults to, say, Tamil starts in English until the recruiter picks.
  let adhocLayer = { rules: { ...adhoc, mode: 'call', assessment_type: 'interview' }, ...(questions ? { questions } : {}) }
  let resolved = ready ? resolveForApplication(application._id, adhocLayer) : null
  if (resolved && !BOT_LANGUAGES.includes(resolved.plan.rules.language)) {
    adhocLayer = { ...adhocLayer, rules: { ...adhocLayer.rules, language: 'en-IN' } }
    resolved = resolveForApplication(application._id, adhocLayer)
  }

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
      <InviteEmail
        application={application} session={result.session} url={result.url}
        note={<>Interview created. Email the link to {candidate.full_name} — it starts only when they open it, and the result comes back here.</>}
        onClose={onClose}
      />
    )
  }

  const set = (patch) => setAdhoc((a) => ({ ...a, ...patch }))
  const setProctoring = (patch) => setAdhoc((a) => ({ ...a, proctoring: { ...(a.proctoring ?? {}), ...patch } }))

  // The editable list: what the recruiter set, else the job's (including any
  // that did not fit the length, so they can be brought back). The opening
  // "Tell me about yourself" is fixed, so it is shown but never in this list.
  const list = (questions ?? [...plan.questions, ...plan.dropped]).filter((q) => !isIntroQuestion(q))
  const questionErrors = list.map((q) => (q.text.trim() ? screenQuestion(q.text) : { ok: false, reason: 'Type the question, or remove it.' }))
  const badQuestions = questionErrors.filter((c) => !c.ok).length
  const serverBlocked = !server || !server.reachable || !server.ready

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
      title={`AI video interview · ${application.candidate_name} · ${job.reference}`}
      onClose={onClose}
      footer={
        <>
          <span className="small muted" style={{ marginRight: 'auto' }}>These settings apply to this candidate only.</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary" onClick={send}
            disabled={sending || problems.length > 0 || badQuestions > 0 || serverBlocked}
          >
            {sending ? 'Creating…' : 'Create interview & email the link'}
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

      <div className="note mb small">
        <strong>AI screening round — video interview.</strong> {INTERVIEW_MODES.call.detail}
      </div>

      <VideoInterview
        plan={plan} candidate={candidate} server={server} list={list} errors={questionErrors}
        spokenLanguages={interviewLanguagesFor(candidate)}
        set={set} setProctoring={setProctoring} setQuestions={setQuestions}
      />
    </Modal>
  )
}

function LanguageChips({ spoken, current, onPick, allowed }) {
  const others = spoken.filter((l) => l.code !== current && (!allowed || allowed.includes(l.code)))
  if (!others.length) return null
  return (
    <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
      {others.map((l) => <button key={l.code} className="chip" onClick={() => onPick(l.code)}>Use {l.resume}</button>)}
    </div>
  )
}

/** The interview's set-up: who (read from their profile), how, and what to ask. */
function VideoInterview({ plan, candidate, server, list, errors, spokenLanguages, set, setProctoring, setQuestions }) {
  const p = plan.rules.proctoring ?? {}
  const hindi = plan.rules.language === 'hi-IN'
  const kept = new Set(plan.questions.map((q) => q.id))
  const fits = Math.min(plan.rules.max_questions, questionsThatFit(plan.rules))

  const edit = (fn) => setQuestions(fn(list.map((q) => ({ ...q }))))
  const change = (i, patch) => edit((qs) => { qs[i] = { ...qs[i], ...patch }; return qs })
  const move = (i, by) => edit((qs) => {
    const j = i + by
    if (j < 0 || j >= qs.length) return qs
    ;[qs[i], qs[j]] = [qs[j], qs[i]]
    return qs
  })
  const remove = (i) => edit((qs) => qs.filter((_, k) => k !== i))
  const add = () => edit((qs) => [...qs, { id: newQuestionId('c'), text: '', text_hi: '', type: 'open', competency: 'experience', weight: 2, must_ask: true }])

  return (
    <>
      <ServerStatus server={server} />

      <h4 className="section-title">Candidate <span className="small muted">· from their profile</span></h4>
      <dl className="kv invite-facts">
        <dt>Name</dt><dd>{candidate.full_name}</dd>
        <dt>Email</dt><dd>{candidate.email ?? <span className="warn-text">No email on file — add one to their profile to email the link</span>}</dd>
        <dt>Phone</dt><dd>{candidate.phone ?? '—'}</dd>
        <dt>Current role</dt><dd>{[candidate.current?.title, candidate.current?.company].filter(Boolean).join(' at ') || '—'}</dd>
        <dt>Experience</dt><dd>{candidate.total_experience_years != null ? `${candidate.total_experience_years} years` : '—'}</dd>
        <dt>Location</dt><dd>{candidate.location?.city ?? '—'}</dd>
        <dt>Languages</dt><dd>{candidate.parsed?.languages?.join(', ') || '—'}</dd>
        <dt>Skills</dt>
        <dd>
          <div className="row wrap" style={{ gap: 4 }}>
            {(candidate.parsed?.skills ?? []).slice(0, 12).map((s) => <span key={s} className="chip">{s}</span>)}
            {!(candidate.parsed?.skills ?? []).length && '—'}
          </div>
        </dd>
      </dl>
      <p className="hint" style={{ marginTop: 6 }}>
        {plan.persona.name} is given these, so the conversation starts from their background. To correct
        anything, edit the candidate’s profile.
      </p>

      <h4 className="section-title">How the interview runs</h4>
      <div className="grid c3">
        <Field label="Language" hint={spokenLanguages.length ? `Their resume lists: ${spokenLanguages.map((l) => l.resume).join(', ')}` : 'The interview runs in English or Hindi'}>
          <Select
            options={languageOptions().filter((o) => BOT_LANGUAGES.includes(o.value))}
            value={plan.rules.language} onChange={(v) => set({ language: v })}
          />
          <LanguageChips spoken={spokenLanguages} current={plan.rules.language} allowed={BOT_LANGUAGES} onPick={(code) => set({ language: code })} />
        </Field>
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
        <Field label="Follow-ups per question" hint="When an answer is vague or has no example">
          <Select
            options={[0, 1, 2].map((n) => ({ value: String(n), label: n === 0 ? 'None' : String(n) }))}
            value={String(plan.rules.follow_ups_per_question ?? 1)}
            onChange={(v) => set({ follow_ups_per_question: Number(v) })}
          />
        </Field>
        <Field label="Pause that ends an answer" hint="Shorter pauses are the candidate thinking">
          <Select
            options={PAUSES.map((s) => ({ value: String(s), label: `${s} seconds${s === DEFAULT_ANSWER_PAUSE ? ' (default)' : ''}` }))}
            value={String(plan.rules.answer_pause_seconds ?? DEFAULT_ANSWER_PAUSE)}
            onChange={(v) => set({ answer_pause_seconds: Number(v) })}
          />
        </Field>
        <Field label="Leaving the tab">
          <Select options={TAB_RULES} value={tabRule(p)} onChange={(v) => setProctoring(TAB_PATCH[v])} />
        </Field>
      </div>
      <Field label={`Instructions for ${plan.persona.name} (optional)`} hint="How to run this interview, beyond the questions — e.g. “Keep it conversational; they are a fresher.”">
        <textarea rows={2} value={plan.rules.instructions ?? ''} onChange={(e) => set({ instructions: e.target.value })} />
      </Field>

      <div className="between" style={{ marginTop: 4, marginBottom: 8 }}>
        <h4 className="section-title" style={{ margin: 0 }}>
          Questions <span className="small muted">· {plan.questions.length} will be asked · {fits} fit in {plan.rules.duration_minutes} min</span>
        </h4>
        <div className="row">
          {/* Back to the job's questions (this invite's edits are dropped). */}
          <button className="btn ghost sm" onClick={() => setQuestions(null)}>Reset to the job’s</button>
          <button className="btn sm" onClick={add}>+ Add question</button>
        </div>
      </div>

      <div className="col" style={{ gap: 8 }}>
        <div className="qedit fixed">
          <div className="between small">
            <strong>Question 1 <span className="muted">· always asked first</span></strong>
            <span className="small muted">🔒 Every interview opens with this</span>
          </div>
          <div className="fixed-value">{hindi ? INTRO_QUESTION.text_hi : INTRO_QUESTION.text}</div>
        </div>
        {list.map((q, i) => (
          <div key={q.id} className={`qedit ${kept.has(q.id) ? '' : 'left-out'}`}>
            <div className="between small">
              <strong>Question {i + 2}{!kept.has(q.id) && q.text.trim() && <span className="warn-text"> · won’t fit in {plan.rules.duration_minutes} min</span>}</strong>
              <div className="row" style={{ gap: 2 }}>
                <label className="check small" style={{ marginRight: 6 }}>
                  <input type="checkbox" checked={Boolean(q.must_ask)} onChange={(e) => change(i, { must_ask: e.target.checked })} /> Always ask
                </label>
                <button className="btn ghost sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button className="btn ghost sm" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Move down">↓</button>
                <button className="btn ghost sm" onClick={() => remove(i)} aria-label="Remove question">✕</button>
              </div>
            </div>
            <textarea
              rows={2} value={q.text} placeholder="Type the question"
              onChange={(e) => change(i, { text: e.target.value })}
            />
            {hindi && (
              <textarea
                rows={2} lang="hi" value={q.text_hi ?? ''} placeholder={`Hindi version (optional) — otherwise ${plan.persona.name} asks it in Hindi from the English`}
                onChange={(e) => change(i, { text_hi: e.target.value })}
              />
            )}
            {!errors[i]?.ok && <div className="field-err">{errors[i].reason}</div>}
          </div>
        ))}
        {!list.length && <div className="note small">Only the opening question so far — add the questions to ask after it.</div>}
      </div>
      <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
        Changes here are for this candidate only; the job’s own questions stay as they are. Questions about
        age, religion, marital status and similar are blocked.
      </p>
    </>
  )
}

function ServerStatus({ server }) {
  if (!server) return <div className="note small mb"><span className="spin" /> Checking the AI video interview server…</div>
  if (!server.reachable) {
    return (
      <div className="note bad small mb">
        <strong>The AI video interview server isn’t running</strong> at {botUrl()}. Start it
        (<code className="mono">cd InterviewBot</code>, then <code className="mono">.venv\Scripts\python -m uvicorn main:app --port 8000</code>),
        or correct its address in Settings → AI video interview.
      </div>
    )
  }
  if (!server.ready) {
    return <div className="note bad small mb"><strong>The interview server is missing its Sarvam settings:</strong> {server.missing.join(', ')}. Add them to InterviewBot/.env.</div>
  }
  return (
    <div className="note good small mb">
      Interview server ready. {server.email ? 'The link is emailed from the HR mailbox.' : 'The link is emailed from your own mail app (the HR mailbox isn’t set up on the server yet).'}
    </div>
  )
}
