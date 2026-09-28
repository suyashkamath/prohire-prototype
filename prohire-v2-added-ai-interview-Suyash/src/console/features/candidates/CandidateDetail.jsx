import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Badge, Tabs, Empty, Match, Field, Menu, Select } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { getCandidate, updateCandidate, candidateReference, primarySkillOf, resumeFile } from '../../../services/candidates.js'
import { sourceLabel, STATES, citiesOf } from '../../../domain/locations.js'
import { downloadText } from '../../../lib/csv.js'
import { useCandidateActions } from './useCandidateActions.jsx'
import { listApplications, addNote } from '../../../services/applications.js'
import { sessionsFor } from '../../../services/interviews.js'
import { activityFor } from '../../../services/core.js'
import { stageLabel, stageTone } from '../../../domain/stages.js'
import { initials, formatDateTime, relative, lpa } from '../../../lib/format.js'

export default function CandidateDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState('applications')
  const actions = useCandidateActions()

  const data = useLive(
    () => {
      const candidate = getCandidate(id)
      if (!candidate) return { candidate: null }
      return {
        candidate,
        applications: listApplications({ candidate_id: candidate._id }),
        activity: activityFor('candidate', candidate._id),
      }
    },
    [id],
  )

  if (!data.candidate) {
    return (
      <>
        <div className="topbar"><h1>Candidate not found</h1></div>
        <div className="page"><Card><Empty title="No such candidate" action={<Link className="btn" to="/candidates">Back to the pool</Link>} /></Card></div>
      </>
    )
  }

  const { candidate: c, applications, activity } = data

  return (
    <>
      <div className="topbar">
        <span className="avatar lg">{initials(c.full_name)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <h1 className="truncate">{c.full_name}</h1>
            <code className="mono dim">{candidateReference(c)}</code>
          </div>
          <div className="small muted">
            {[c.current?.title, c.current?.company].filter(Boolean).join(' at ') || 'No current role recorded'}
            {c.location?.city && ` · ${c.location.city}`}
          </div>
        </div>
        <div className="spacer" />
        <Link className="btn" to="/candidates">Back</Link>
        <button className="btn primary" onClick={() => actions.open('tagjob', c, null)}>Add to a job</button>
        <Menu items={actions.itemsFor(c, null)} className="btn" label="More ▾" />
      </div>

      <div className="page wide">
        {c.flag && (
          <div className="note bad mb">
            <strong>⚑ Flagged</strong> by {c.flag.by}: {c.flag.reason}
          </div>
        )}
        {((c.tags ?? []).length > 0 || c.consent?.data_processing) && (
          <div className="row wrap mb" style={{ gap: 6 }}>
            {(c.tags ?? []).map((t) => <span key={t} className="badge">{t}</span>)}
            {c.consent?.data_processing === 'granted' && <Badge tone="good">✓ Data consent given</Badge>}
            {c.consent?.data_processing === 'requested' && <Badge tone="info">Data consent requested</Badge>}
            {c.consent?.data_processing === 'refused' && <Badge tone="bad">Data consent refused — delete this profile</Badge>}
          </div>
        )}
        <div className="grid split">
          <div>
            <Tabs
              value={tab} onChange={setTab}
              tabs={[
                { key: 'applications', label: 'Applications', count: applications.length },
                { key: 'resume', label: 'Resume' },
                { key: 'activity', label: 'Activity', count: activity.length },
              ]}
            />
            <div style={{ marginTop: 16 }}>
              {tab === 'applications' && <Applications rows={applications} navigate={navigate} candidate={c} actions={actions} />}
              {tab === 'resume' && <Resume candidate={c} />}
              {tab === 'activity' && <Activity rows={activity} />}
            </div>
          </div>

          <Facts candidate={c} />
        </div>
      </div>
      {actions.element}
    </>
  )
}

function Applications({ rows, navigate, candidate, actions }) {
  const toast = useToast()
  if (!rows.length) {
    return (
      <Card>
        <Empty title="Not on any job yet" action={<button className="btn primary" onClick={() => actions.open('tagjob', candidate, null)}>Add to a job</button>}>
          Saved in the database for later. Add them to a job when a suitable position opens.
        </Empty>
      </Card>
    )
  }
  return (
    <div className="col">
      {rows.map((a) => {
        const sessions = sessionsFor(a._id)
        return (
          <Card key={a._id}>
            <div className="between">
              <div>
                <div className="row">
                  <code className="mono dim">{a.job_reference}</code>
                  <strong>{a.job_title}</strong>
                  <Badge tone={stageTone(a.stage)}>{stageLabel(a.stage)}</Badge>
                </div>
                <div className="small muted">Added {relative(a.created_at)} · {sourceLabel(a.source?.channel)}</div>
              </div>
              <div className="row">
                <Menu items={actions.itemsFor(candidate, a)} />
                {a.screening && <Match value={a.screening.match_percent} />}
                {a.interview_summary?.state === 'completed' && (
                  <Link className="btn sm" to={`/interviews/${a.interview_summary.session_id}`}>Report</Link>
                )}
                <button className="btn sm" onClick={() => navigate(`/jobs/${a.job_id}`)}>Open job</button>
              </div>
            </div>

            {a.screening && (
              <>
                <div className="divider" />
                <div className="grid c2" style={{ gap: 14 }}>
                  <div>
                    <h4>Pros</h4>
                    <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                      {a.screening.pros.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                  <div>
                    <h4>Cons</h4>
                    <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                      {a.screening.cons.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                </div>
              </>
            )}

            {sessions.length > 0 && (
              <>
                <div className="divider" />
                <h4>Interview attempts</h4>
                <div className="col small" style={{ gap: 6, marginTop: 6 }}>
                  {sessions.map((s) => (
                    <div key={s._id} className="between">
                      <span>
                        Attempt {s.attempt} · <Badge tone={s.state === 'completed' ? 'good' : s.state === 'expired' ? 'bad' : 'info'}>{s.state.replace('_', ' ')}</Badge>
                        <span className="dim"> · {s.plan.rules.language} · {s.plan.rules.duration_minutes} min · {s.plan.questions.length} questions</span>
                      </span>
                      <Link className="btn ghost sm" to={`/interviews/${s._id}`}>Open</Link>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="divider" />
            <NoteBox application={a} toast={toast} />
          </Card>
        )
      })}
    </div>
  )
}

function NoteBox({ application, toast }) {
  const [text, setText] = useState('')
  return (
    <>
      {(application.notes ?? []).length > 0 && (
        <div className="col small" style={{ gap: 6, marginBottom: 10 }}>
          {application.notes.map((n, i) => (
            <div key={i}>
              <div>{n.text}</div>
              <div className="dim" style={{ fontSize: 12 }}>{n.by} · {relative(n.at)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <input
          type="text" value={text} placeholder="Add a note" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              addNote(application._id, text)
              setText('')
              toast('Note added.')
            }
          }}
        />
      </div>
    </>
  )
}

function Resume({ candidate }) {
  return (
    <div className="col">
      <Card
        title="Resume"
        actions={<button className="btn sm" onClick={() => { const f = resumeFile(candidate); downloadText(f.filename, f.text) }}>Download</button>}
      >
        {candidate.resume_text
          ? <div className="pre" style={{ maxHeight: 520, overflowY: 'auto' }}>{candidate.resume_text}</div>
          : <p className="muted">No resume on file — this candidate was entered manually.</p>}
      </Card>

      {(candidate.resume_history ?? []).length > 0 && (
        <Card title="Versions">
          <p className="small muted">Every resume ever uploaded is kept. A newer one never overwrites an older one.</p>
          <table className="table">
            <thead><tr><th>File</th><th>Uploaded</th><th>By</th></tr></thead>
            <tbody>
              {candidate.resume_history.map((v, i) => (
                <tr key={i}>
                  <td className="small">{v.filename}</td>
                  <td className="small muted">{formatDateTime(v.uploaded_at)}</td>
                  <td className="small muted">{v.uploaded_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function Activity({ rows }) {
  if (!rows.length) return <Card><Empty title="No activity" /></Card>
  return (
    <Card>
      <div className="col" style={{ gap: 11 }}>
        {rows.map((a) => (
          <div key={a._id} className="small">
            <div>{a.summary}</div>
            <div className="dim">{a.by} · {formatDateTime(a.at)}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

/**
 * The facts panel — notice period, expected CTC, location. Often the first
 * thing a recruiter reads, so it stays visible on every tab.
 */
function Facts({ candidate: c }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState({
    full_name: c.full_name, email: c.email ?? '', phone: c.phone ?? '',
    title: c.current?.title ?? '', company: c.current?.company ?? '',
    state: c.location?.state ?? '', city: c.location?.city ?? '',
    primary_skill: c.primary_skill ?? '', skills: (c.parsed?.skills ?? []).join(', '),
    notice_period_days: c.notice_period_days ?? '', expected_ctc_lpa: c.expected_ctc_lpa ?? '',
    current_ctc_lpa: c.current_ctc_lpa ?? '', total_experience_years: c.total_experience_years ?? '',
  })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  if (editing) {
    return (
      <Card
        title="Edit details"
        actions={
          <>
            <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
            <button
              className="btn sm primary"
              onClick={() => {
                updateCandidate(c._id, {
                  full_name: f.full_name,
                  email: f.email || null,
                  phone: f.phone || null,
                  current: { title: f.title || null, company: f.company || null },
                  location: { state: f.state || null, city: f.city || null },
                  primary_skill: f.primary_skill || null,
                  skills: f.skills.split(',').map((x) => x.trim()).filter(Boolean),
                  notice_period_days: f.notice_period_days === '' ? null : Number(f.notice_period_days),
                  expected_ctc_lpa: f.expected_ctc_lpa === '' ? null : Number(f.expected_ctc_lpa),
                  current_ctc_lpa: f.current_ctc_lpa === '' ? null : Number(f.current_ctc_lpa),
                  total_experience_years: f.total_experience_years === '' ? null : Number(f.total_experience_years),
                })
                toast('Saved. Your edits will survive a re-parse.', 'good')
                setEditing(false)
              }}
            >
              Save
            </button>
          </>
        }
      >
        <Field label="Name"><input type="text" value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input type="text" value={f.phone} onChange={set('phone')} /></Field>
        <div className="grid c2">
          <Field label="Current title"><input type="text" value={f.title} onChange={set('title')} /></Field>
          <Field label="Company"><input type="text" value={f.company} onChange={set('company')} /></Field>
        </div>
        <div className="grid c2">
          <Field label="State">
            <Select options={STATES.map((x) => x.name)} value={f.state} placeholder="Select" onChange={(v) => setF((x) => ({ ...x, state: v, city: '' }))} />
          </Field>
          <Field label="City">
            <Select options={citiesOf(f.state)} value={f.city} placeholder={f.city || 'Select'} disabled={!f.state} onChange={(v) => setF((x) => ({ ...x, city: v }))} />
          </Field>
        </div>
        <Field label="Key skills" hint="Comma separated."><input type="text" value={f.skills} onChange={set('skills')} /></Field>
        <Field label="Primary skill">
          <Select options={f.skills.split(',').map((x) => x.trim()).filter(Boolean)} value={f.primary_skill} placeholder="First skill" onChange={(v) => setF((x) => ({ ...x, primary_skill: v }))} />
        </Field>
        <div className="grid c2">
          <Field label="Experience (yrs)"><input type="number" step="0.5" value={f.total_experience_years} onChange={set('total_experience_years')} /></Field>
          <Field label="Notice (days)"><input type="number" value={f.notice_period_days} onChange={set('notice_period_days')} /></Field>
        </div>
        <div className="grid c2">
          <Field label="Current (LPA)"><input type="number" step="0.5" value={f.current_ctc_lpa} onChange={set('current_ctc_lpa')} /></Field>
          <Field label="Expected (LPA)"><input type="number" step="0.5" value={f.expected_ctc_lpa} onChange={set('expected_ctc_lpa')} /></Field>
        </div>
        <div className="note small">
          What you type here is kept even if a newer resume is uploaded later.
        </div>
      </Card>
    )
  }

  return (
    <div className="col">
      <Card title="Facts" actions={<button className="btn sm" onClick={() => setEditing(true)}>Edit</button>}>
        <dl className="kv">
          <dt>Candidate ID</dt><dd><code className="mono">{candidateReference(c)}</code></dd>
          <dt>Email</dt><dd className="truncate">{c.email ?? <span className="dim">—</span>}</dd>
          <dt>Phone</dt><dd>{c.phone ?? <span className="dim">—</span>}</dd>
          <dt>Experience</dt><dd>{c.total_experience_years != null ? `${c.total_experience_years} years` : <span className="dim">—</span>}</dd>
          <dt>Notice</dt>
          <dd>{c.notice_period_days == null ? <span className="dim">—</span> : c.notice_period_days === 0 ? <Badge tone="good">Immediate</Badge> : `${c.notice_period_days} days`}</dd>
          <dt>Current CTC</dt><dd>{lpa(c.current_ctc_lpa)}</dd>
          <dt>Expected CTC</dt><dd>{lpa(c.expected_ctc_lpa)}</dd>
          <dt>Location</dt><dd>{c.location?.city ?? <span className="dim">—</span>}</dd>
          <dt>Primary skill</dt><dd>{primarySkillOf(c) ?? <span className="dim">—</span>}</dd>
          <dt>Source</dt><dd className="small">{sourceLabel(c.source?.channel)}{c.source?.detail && c.source.channel === 'referral' ? ` — ${c.source.detail}` : ''}</dd>
          <dt>Added</dt><dd className="small">{formatDateTime(c.created_at)} by {c.created_by}</dd>
        </dl>
      </Card>

      <Card title="Skills and languages">
        <div className="between mb">
          <span className="small muted">Parser confidence</span>
          <Badge tone={(c.parsed?.confidence ?? 0) >= 0.8 ? 'good' : (c.parsed?.confidence ?? 0) >= 0.5 ? 'warn' : 'bad'}>
            {Math.round((c.parsed?.confidence ?? 0) * 100)}%
          </Badge>
        </div>
        <h4>Skills</h4>
        <div className="row wrap" style={{ gap: 4, margin: '6px 0 12px' }}>
          {(c.parsed?.skills ?? []).length
            ? c.parsed.skills.map((s) => <span key={s} className="chip">{s}</span>)
            : <span className="dim small">None detected</span>}
        </div>
        {(c.parsed?.languages ?? []).length > 0 && (
          <>
            <h4>Languages</h4>
            <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
              {c.parsed.languages.map((l) => <span key={l} className="chip">{l}</span>)}
            </div>
          </>
        )}
        {(c.parsed?.links?.linkedin || c.parsed?.links?.github) && (
          <div className="col small" style={{ marginTop: 12, gap: 4 }}>
            {c.parsed.links.linkedin && <a href={c.parsed.links.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
            {c.parsed.links.github && <a href={c.parsed.links.github} target="_blank" rel="noreferrer">GitHub</a>}
          </div>
        )}
      </Card>
    </div>
  )
}
