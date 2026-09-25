import { useState } from 'react'

import { Card, Field, Select, Badge } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import {
  orgTemplate, listTemplates, saveTemplate, ensureJobQuestions, ensureQualification, affectedInvitedCount,
} from '../../../services/interviews.js'
import { resolvePlan, STRICTNESS, ASSESSMENT_TYPES, INTERVIEW_MODES } from '../../../domain/resolvePlan.js'
import { QUALIFICATION_KINDS, describeKnockout } from '../../../domain/qualification.js'
import { screenQuestion } from '../../../domain/ai.js'
import { languageOptions, ALLOWED_DURATIONS } from '../../../domain/locations.js'
import { newQuestionId } from '../../../lib/ids.js'

/**
 * The job's interview DEFAULTS.
 *
 * Unlike a one-time setup, everything here can be changed at any time, and
 * each candidate can still get different settings when you invite them.
 * Changes apply to new invites; interviews already sent keep what they were
 * sent with, so a finished report never changes underneath you.
 */
export default function InterviewSetup({ job }) {
  const toast = useToast()
  const [generating, setGenerating] = useState(false)
  const [newQuestion, setNewQuestion] = useState('')

  const org = orgTemplate()
  const tpl = listTemplates({ scope: 'job', scope_id: job._id })[0] ?? null

  const layers = [
    { source: 'company default', ...org },
    job.interview_language_default && {
      source: 'this job',
      rules: { language: job.interview_language_default },
    },
    tpl && { source: 'this job', ...tpl },
  ].filter(Boolean)

  const plan = resolvePlan(layers, { job })
  const affected = tpl ? affectedInvitedCount(tpl._id) : 0
  const type = plan.rules.assessment_type
  const p = plan.rules.proctoring ?? {}

  const base = () => ({
    _id: tpl?._id,
    name: tpl?.name ?? `${job.reference} · ${job.title}`,
    scope: 'job',
    scope_id: job._id,
  })

  async function generate() {
    setGenerating(true)
    try {
      if (tpl?.questions?.length) saveTemplate({ ...base(), questions: [] })
      await ensureJobQuestions(job._id, null)
      toast('Questions prepared from the job description.', 'good')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setGenerating(false)
    }
  }

  const patchRules = (patch) => saveTemplate({ ...base(), rules: { ...(tpl?.rules ?? {}), ...patch } })
  const patchProctoring = (patch) => patchRules({ proctoring: { ...(tpl?.rules?.proctoring ?? {}), ...patch } })
  const patchQuestions = (questions) => saveTemplate({ ...base(), questions })
  const patchQualification = (qualification) => saveTemplate({ ...base(), qualification })

  const addQuestion = () => {
    const text = newQuestion.trim()
    if (!text) return
    const check = screenQuestion(text)
    if (!check.ok) return toast(check.reason, 'bad')
    patchQuestions([
      ...(tpl?.questions ?? plan.questions),
      { id: newQuestionId('j'), text, type: 'open', competency: 'experience', weight: 2, must_ask: false },
    ])
    setNewQuestion('')
  }

  return (
    <div className="col">
      <div className="note info">
        These are the <strong>defaults for {job.reference}</strong>. Change them any time — and when you
        invite someone, you can still pick a different language, length, strictness or questions for
        that one candidate.
        {affected > 0 && <> {affected} interview{affected === 1 ? ' is' : 's are'} already sent and keep their original settings.</>}
      </div>

      <div className="grid split">
        <div className="col">
          {type !== 'qualification' && (
            <Card
              title={`Interview questions (${plan.questions.length})`}
              actions={
                <button className="btn sm" onClick={generate} disabled={generating}>
                  {generating ? 'Preparing…' : plan.questions.length ? 'Start again from the JD' : 'Prepare from the JD'}
                </button>
              }
            >
              {plan.questions.length === 0 ? (
                <p className="muted">
                  No questions yet — and that is fine. If you add none, {plan.persona.name} prepares them
                  from the job description and each candidate&rsquo;s resume. Add your own below if there
                  are questions your stakeholders always ask.
                </p>
              ) : (
                <div className="col" style={{ gap: 10 }}>
                  {plan.questions.map((q, i) => (
                    <QuestionRow
                      key={q.id}
                      n={i + 1}
                      q={q}
                      onChange={(patch) =>
                        patchQuestions((tpl?.questions ?? plan.questions).map((x) => (x.id === q.id ? { ...x, ...patch } : x)))
                      }
                      onRemove={() => patchQuestions((tpl?.questions ?? plan.questions).filter((x) => x.id !== q.id))}
                    />
                  ))}
                </div>
              )}
              {plan.dropped.length > 0 && (
                <div className="note small mt">{plan.dropped.length} question{plan.dropped.length === 1 ? '' : 's'} won&rsquo;t fit in {plan.rules.duration_minutes} minutes; the lowest-weight ones are left out.</div>
              )}

              <div className="divider" />
              <Field label="Add a question" hint="No limit. Questions about age, religion, marital status and similar are blocked automatically.">
                <div className="row">
                  <input
                    type="text" value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addQuestion())}
                    placeholder="Walk me through your agency recruitment numbers for last year."
                  />
                  <button className="btn" onClick={addQuestion}>Add</button>
                </div>
              </Field>
            </Card>
          )}

          {type !== 'interview' && (
            <QuestionnaireCard job={job} questions={plan.qualification} onSave={patchQualification} />
          )}
        </div>

        <div className="col">
          <Card title="What candidates get">
            <Field label="Assessment">
              <Select
                options={Object.entries(ASSESSMENT_TYPES).map(([k, v]) => ({ value: k, label: v.label }))}
                value={type}
                onChange={(v) => { patchRules({ assessment_type: v }); if (v !== 'interview') ensureQualification(job._id) }}
              />
            </Field>

            {type !== 'qualification' && (
              <>
                <div className="grid c2">
                  <Field label="Language">
                    <Select options={languageOptions()} value={plan.rules.language} onChange={(v) => patchRules({ language: v })} />
                  </Field>
                  <Field label="Format">
                    <Select
                      options={Object.entries(INTERVIEW_MODES).map(([k, v]) => ({ value: k, label: v.label }))}
                      value={plan.rules.mode} onChange={(v) => patchRules({ mode: v })}
                    />
                  </Field>
                </div>
                <div className="grid c2">
                  <Field label="Length">
                    <Select
                      options={ALLOWED_DURATIONS.map((d) => ({ value: String(d), label: `${d} minutes` }))}
                      value={String(plan.rules.duration_minutes)}
                      onChange={(v) => patchRules({ duration_minutes: Number(v), light_mode: false })}
                    />
                  </Field>
                  <Field label="Follow-ups per question">
                    <input
                      type="number" min="0" max="3" value={plan.rules.follow_ups_per_question}
                      onChange={(e) => patchRules({ follow_ups_per_question: Number(e.target.value) })}
                    />
                  </Field>
                </div>
                <label className="check mb">
                  <input type="checkbox" checked={plan.rules.light_mode} onChange={(e) => patchRules({ light_mode: e.target.checked })} />
                  <span>Light mode — 15 minutes, at most 5 questions</span>
                </label>
                <Field label="Strictness" hint={`${STRICTNESS[plan.rules.strictness].tone}. Pass mark ${plan.scoring.shortlist_threshold}/100.`}>
                  <Select
                    options={Object.entries(STRICTNESS).map(([k, v]) => ({ value: k, label: `${v.label} — pass at ${v.threshold}` }))}
                    value={plan.rules.strictness} onChange={(v) => patchRules({ strictness: v })}
                  />
                </Field>
              </>
            )}
          </Card>

          {type !== 'qualification' && (
            <Card title="Cheating checks">
              <label className="check">
                <input type="checkbox" checked={p.tab_switch_warning !== false} onChange={(e) => patchProctoring({ tab_switch_warning: e.target.checked })} />
                <span>Warn when the candidate leaves the tab</span>
              </label>
              <div className="row" style={{ paddingLeft: 26, opacity: p.tab_switch_warning === false ? 0.5 : 1 }}>
                <label className="check" style={{ margin: 0 }}>
                  <input
                    type="checkbox" disabled={p.tab_switch_warning === false}
                    checked={p.auto_terminate !== false} onChange={(e) => patchProctoring({ auto_terminate: e.target.checked })}
                  />
                  <span>End the interview after</span>
                </label>
                <input
                  type="number" min="1" max="10" style={{ width: 64 }}
                  disabled={p.tab_switch_warning === false || p.auto_terminate === false}
                  value={p.max_tab_switches ?? 3} onChange={(e) => patchProctoring({ max_tab_switches: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span className="small muted">warnings</span>
              </div>
              <label className="check">
                <input type="checkbox" checked={p.paste_detection !== false} onChange={(e) => patchProctoring({ paste_detection: e.target.checked })} />
                <span>Note pasted answers</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={Boolean(p.face_presence)} onChange={(e) => patchProctoring({ face_presence: e.target.checked })} />
                <span>
                  Check the face stays in frame, and no second person appears
                  <span className="hint" style={{ display: 'block' }}>Video format only. Uses the browser&rsquo;s face detector where available (Chrome).</span>
                </span>
              </label>
              <div className="hint">Every event is listed in the report with the time it happened. Nothing is scored against the candidate automatically.</div>
            </Card>
          )}

          {type !== 'qualification' && (
            <Card title="How the score is made">
              <dl className="kv small">
                {plan.scoring.competencies.map((c) => (
                  <div key={c.key} style={{ display: 'contents' }}>
                    <dt>{c.label}</dt>
                    <dd className="tabular">{Math.round(c.weight * 100)}%</dd>
                  </div>
                ))}
                <dt><strong>Recommended at</strong></dt>
                <dd className="tabular"><strong>{plan.scoring.shortlist_threshold}/100</strong></dd>
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function QuestionRow({ n, q, onChange, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(q.text)
  const toast = useToast()

  return (
    <div className="card">
      <div className="card-body tight">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="dim tabular" style={{ flex: 'none', paddingTop: 2 }}>{n}.</span>
          {editing ? (
            <textarea value={text} rows={2} onChange={(e) => setText(e.target.value)} autoFocus />
          ) : (
            <div style={{ flex: 1 }}>{q.text}</div>
          )}
          <div className="row" style={{ flex: 'none', gap: 4 }}>
            {editing ? (
              <>
                <button
                  className="btn sm primary"
                  onClick={() => {
                    const check = screenQuestion(text)
                    if (!check.ok) return toast(check.reason, 'bad')
                    onChange({ text })
                    setEditing(false)
                  }}
                >
                  Save
                </button>
                <button className="btn sm" onClick={() => { setText(q.text); setEditing(false) }}>Cancel</button>
              </>
            ) : (
              <>
                <button className="btn ghost sm" onClick={() => setEditing(true)}>Edit</button>
                <button className="btn ghost sm" onClick={onRemove} aria-label="Remove question">✕</button>
              </>
            )}
          </div>
        </div>

        <div className="row wrap" style={{ gap: 5, marginTop: 7 }}>
          <span className="chip">{q.type}</span>
          {q.primary && <Badge tone="accent">primary skill</Badge>}
          <Select
            options={[1, 2, 3].map((w) => ({ value: String(w), label: `weight ${w}` }))}
            value={String(q.weight ?? 1)} onChange={(v) => onChange({ weight: Number(v) })}
            style={{ width: 96, padding: '2px 6px', fontSize: 12 }}
          />
          <label className="check small" style={{ gap: 5 }}>
            <input type="checkbox" checked={Boolean(q.must_ask)} onChange={(e) => onChange({ must_ask: e.target.checked })} />
            always ask
          </label>
          {q.expected_points?.length > 0 && (
            <span className="chip" title="Never shown to the candidate">
              listening for: {q.expected_points.join(', ')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** The questionnaire editor. A knockout flags an answer; it never rejects by itself. */
function QuestionnaireCard({ job, questions, onSave }) {
  const toast = useToast()
  const [draft, setDraft] = useState({ text: '', kind: 'yes_no', knock: '', options: '' })

  const add = () => {
    const text = draft.text.trim()
    if (!text) return
    const check = screenQuestion(text)
    if (!check.ok) return toast(check.reason, 'bad')
    const q = { id: newQuestionId('k'), text, kind: draft.kind }
    if (draft.kind === 'choice') q.options = draft.options.split(',').map((s) => s.trim()).filter(Boolean)
    if (draft.knock !== '') {
      q.knockout = draft.kind === 'number' ? { below: Number(draft.knock) } : { answer: draft.knock }
    }
    onSave([...questions, q])
    setDraft({ text: '', kind: 'yes_no', knock: '', options: '' })
  }

  return (
    <Card
      title={`Questionnaire (${questions.length})`}
      actions={questions.length === 0 && <button className="btn sm" onClick={() => ensureQualification(job._id)}>Use the standard set</button>}
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        Short typed questions the candidate answers on their phone — before the interview, or instead of it.
      </p>
      <div className="col" style={{ gap: 8 }}>
        {questions.map((q, i) => (
          <div key={q.id} className="between qrow">
            <div style={{ minWidth: 0 }}>
              <div>{i + 1}. {q.text}</div>
              <div className="row wrap small dim" style={{ gap: 5, marginTop: 3 }}>
                <span className="chip">{QUALIFICATION_KINDS[q.kind]?.label ?? q.kind}</span>
                {q.options?.length > 0 && <span className="chip">{q.options.join(' / ')}</span>}
                {describeKnockout(q) && <Badge tone="warn">{describeKnockout(q)}</Badge>}
              </div>
            </div>
            <button className="btn ghost sm" onClick={() => onSave(questions.filter((x) => x.id !== q.id))} aria-label="Remove">✕</button>
          </div>
        ))}
      </div>

      <div className="divider" />
      <Field label="Add a question">
        <input
          type="text" value={draft.text} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
          placeholder="Do you have a two-wheeler for field visits?"
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
        />
      </Field>
      <div className="grid c3">
        <Field label="Answer type">
          <Select
            options={Object.entries(QUALIFICATION_KINDS).map(([k, v]) => ({ value: k, label: v.label }))}
            value={draft.kind} onChange={(v) => setDraft((d) => ({ ...d, kind: v, knock: '' }))}
          />
        </Field>
        {draft.kind === 'choice' && (
          <Field label="Options"><input type="text" value={draft.options} onChange={(e) => setDraft((d) => ({ ...d, options: e.target.value }))} placeholder="Pune, Mumbai, Either" /></Field>
        )}
        {draft.kind === 'yes_no' && (
          <Field label="Flag if">
            <Select options={[{ value: '', label: 'Never' }, { value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} value={draft.knock} onChange={(v) => setDraft((d) => ({ ...d, knock: v }))} />
          </Field>
        )}
        {draft.kind === 'number' && (
          <Field label="Flag if below"><input type="number" value={draft.knock} onChange={(e) => setDraft((d) => ({ ...d, knock: e.target.value }))} placeholder="e.g. 2" /></Field>
        )}
        <div className="field" style={{ alignSelf: 'end' }}><button className="btn" onClick={add}>Add</button></div>
      </div>
    </Card>
  )
}
