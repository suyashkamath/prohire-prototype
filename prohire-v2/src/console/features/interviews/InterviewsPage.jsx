import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Badge, Empty, Select, CopyButton } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { listSessions, linkFor, resendInvite, cancelSession } from '../../../services/interviews.js'
import { relative, mmss } from '../../../lib/format.js'

const STATE_TONE = {
  invited: 'info', in_progress: 'warn', completed: 'good',
  abandoned: 'warn', expired: 'bad', cancelled: '', failed: 'bad',
}

/** Where a recruiter starts their morning — every session, every job. */
export default function InterviewsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [state, setState] = useState('')

  const rows = useLive(() => listSessions({ state: state || undefined }), [state])
  const all = useLive(() => listSessions())

  const counts = all.reduce((acc, s) => ({ ...acc, [s.state]: (acc[s.state] ?? 0) + 1 }), {})

  return (
    <>
      <div className="topbar">
        <h1>Interviews</h1>
        <div className="spacer" />
        <Select
          value={state} onChange={setState} placeholder="Every state" style={{ width: 190 }}
          options={Object.keys(STATE_TONE).map((s) => ({
            value: s, label: `${s.replace('_', ' ')}${counts[s] ? ` (${counts[s]})` : ''}`,
          }))}
        />
      </div>

      <div className="page">
        {all.length === 0 ? (
          <Card>
            <Empty title="No interviews yet">
              Invite a screened candidate from a job&rsquo;s pipeline. The invite freezes the
              question plan into the session, so later edits to the job cannot change it.
            </Empty>
          </Card>
        ) : rows.length === 0 ? (
          <Card><Empty title={`No sessions in "${state.replace('_', ' ')}"`} /></Card>
        ) : (
          <div className="col">
            {rows.map((s) => (
              <Card key={s._id}>
                <div className="between wrap">
                  <div style={{ minWidth: 0 }}>
                    <div className="row wrap">
                      <strong>{s.plan.candidate_context?.full_name ?? 'Candidate'}</strong>
                      <Badge tone={STATE_TONE[s.state]}>{s.state.replace('_', ' ')}</Badge>
                      {s.attempt > 1 && <span className="chip">attempt {s.attempt}</span>}
                    </div>
                    <div className="small muted">
                      <code className="mono dim">{s.plan.job_context?.reference}</code>{' '}
                      {s.plan.job_context?.title}
                      {' · '}{s.plan.questions.length} questions · {s.plan.rules.duration_minutes} min
                      {' · '}{s.plan.persona.language_label ?? s.plan.rules.language}
                      {s.bot && ' · AI video interview'}
                      {' · '}{s.plan.rules.strictness}
                    </div>
                    <div className="small dim" style={{ marginTop: 3 }}>
                      {s.state === 'invited' && `Invited ${relative(s.invite.issued_at)} · expires ${relative(s.invite.expires_at)}`}
                      {s.state === 'in_progress' && `Started ${relative(s.started_at)} · ${s.turns.filter((t) => t.role === 'candidate').length} answers so far`}
                      {s.state === 'completed' && `Finished ${relative(s.ended_at)} · ${mmss(s.duration_seconds ?? 0)}${s.bot && !s.report_id ? ' · report on its way' : ''}`}
                      {s.state === 'expired' && `Never opened. Invited ${relative(s.invite.issued_at)}.`}
                      {s.state === 'abandoned' && `Started ${relative(s.started_at)}, never finished. Answered questions were still scored.`}
                    </div>
                  </div>

                  <div className="row" style={{ flex: 'none' }}>
                    {s.state === 'completed' && (
                      <button className="btn primary sm" onClick={() => navigate(`/interviews/${s._id}`)}>
                        Open report
                      </button>
                    )}
                    {(s.state === 'invited' || s.state === 'expired') && (
                      <>
                        <CopyButton text={linkFor(s)} label="Copy link" />
                        {/* A voice call's link is the candidate's; opening it would start their call. */}
                        {!s.bot && <a className="btn sm" href={linkFor(s)} target="_blank" rel="noreferrer">Open</a>}
                        <button
                          className="btn sm"
                          onClick={() => { resendInvite(s._id); toast('Re-sent — expiry extended by 7 days.', 'good') }}
                        >
                          Resend
                        </button>
                        <button
                          className="btn ghost sm"
                          onClick={() => { cancelSession(s._id); toast('Cancelled.') }}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {s.state === 'in_progress' && (
                      <button className="btn sm" onClick={() => navigate(`/interviews/${s._id}`)}>Watch</button>
                    )}
                    {(s.state === 'abandoned') && (
                      <button className="btn sm" onClick={() => navigate(`/interviews/${s._id}`)}>Open</button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
