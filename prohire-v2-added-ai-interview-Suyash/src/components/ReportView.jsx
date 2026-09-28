// The interview report (§14.3).
//
// Shared between the recruiter console and the public share link, so it lives
// here rather than under either surface. `variant="public"` drops what a
// hiring manager with no account should not see: internal notes, sourcing
// details and the action buttons.
//
// Read top to bottom it answers, in order: recommended or not, and why → how
// they did on each skill → how they communicate → anything suspicious → every
// question with its answer and video → the CV.

import { useRef } from 'react'

import { Card, Badge, Bar } from './ui/index.jsx'
import RecordingPlayer from './RecordingPlayer.jsx'
import { formatDateTime, mmss, lpa } from '../lib/format.js'
import { STRICTNESS } from '../domain/resolvePlan.js'

const REC = {
  shortlist: { label: 'Recommended', tone: 'good', mark: '✓' },
  hold:      { label: 'Hold — review', tone: 'warn', mark: '◐' },
  reject:    { label: 'Not recommended', tone: 'bad', mark: '✕' },
}

const INTEGRITY = [
  ['tab_switches', 'Left the interview tab'],
  ['paste_events', 'Pasted text into an answer'],
  ['face_missing', 'Face not visible'],
  ['multiple_faces', 'More than one face in view'],
  ['fullscreen_exits', 'Exited full screen'],
]

export default function ReportView({ report, session, candidate, variant = 'console' }) {
  const rec = REC[report.recommendation] ?? REC.hold
  const plan = session.plan
  const isPublic = variant === 'public'
  const videoRef = useRef(null)
  const recordingStart = session.recording?.started_at ? new Date(session.recording.started_at).getTime() : null
  const name = plan.candidate_context?.full_name ?? 'Candidate'

  const seekTo = (questionId) => {
    const asked = session.turns.find((t) => t.question_id === questionId && t.kind === 'question')
    if (!asked || !recordingStart || !videoRef.current) return
    videoRef.current.currentTime = Math.max(0, (new Date(asked.at).getTime() - recordingStart) / 1000 - 1)
    videoRef.current.play?.()
    videoRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }
  const offsetOf = (questionId) => {
    const asked = session.turns.find((t) => t.question_id === questionId && t.kind === 'question')
    if (!asked || !recordingStart) return null
    return Math.max(0, (new Date(asked.at).getTime() - recordingStart) / 1000)
  }
  const answersFor = (questionId) => session.turns.filter((t) => t.question_id === questionId)

  const integrity = report.integrity ?? {
    tab_switches: session.integrity?.tab_switches ?? 0, total: session.integrity?.tab_switches ?? 0, level: 'none',
  }
  const hasInterview = report.per_question?.length > 0

  return (
    <div className="col report">
      <Card>
        <div className="between wrap">
          <div>
            <h1>{name}</h1>
            <div className="small muted">
              {plan.job_context?.reference} · {plan.job_context?.title}
              {' · '}{formatDateTime(session.ended_at)}
              {session.duration_seconds != null && ` · ${mmss(session.duration_seconds)} long`}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Badge tone={rec.tone} className="lg">{rec.mark} {rec.label}</Badge>
            {report.overall_score != null && (
              <>
                <div className="stat-value" style={{ marginTop: 6 }}>{report.overall_score}<span className="dim" style={{ fontSize: 15 }}>/100</span></div>
                <div className="small dim">recommended at {plan.scoring.shortlist_threshold}</div>
              </>
            )}
          </div>
        </div>

        <p style={{ fontSize: 15.5, marginTop: 14, marginBottom: 0 }}>{report.headline}</p>
        {report.recommendation_reason && (
          <div className="note mt"><strong>Why:</strong> {report.recommendation_reason}</div>
        )}

        <div className="row wrap mt" style={{ gap: 6 }}>
          <span className="chip">{plan.persona.language_label ?? report.conducted_in}</span>
          {hasInterview && <span className="chip">{STRICTNESS[plan.rules.strictness]?.label ?? plan.rules.strictness} mode</span>}
          {plan.rules.light_mode && <span className="chip">light mode</span>}
          {hasInterview && <span className="chip">{report.signals.coverage.questions_answered}/{report.signals.coverage.questions_planned} answered</span>}
          {integrity.total > 0
            ? <span className={`chip ${integrity.level === 'high' ? 'bad' : 'warn'}`}>⚠ {integrity.total} integrity event{integrity.total === 1 ? '' : 's'}</span>
            : hasInterview && <span className="chip">no integrity events</span>}
          {session.attempt > 1 && <span className="chip">attempt {session.attempt}</span>}
        </div>

        {report.confidence === 'low' && hasInterview && (
          <div className="note warn mt">
            <strong>Low confidence.</strong> Too little was answered to form a reliable view. Treat this
            as a prompt to call them, not as a decision.
          </div>
        )}
      </Card>

      <div className="grid split">
        <div className="col">
          {report.skills?.some((s) => s.score != null) && (
            <Card title="Skills">
              <div className="col" style={{ gap: 12 }}>
                {report.skills.filter((s) => s.score != null).map((s) => (
                  <div key={s.skill}>
                    <div className="between" style={{ marginBottom: 5 }}>
                      <strong>{s.primary && '★ '}{s.skill}{s.primary && <span className="dim small"> · primary skill</span>}</strong>
                      <span className="tabular">{s.out_of_10}/10</span>
                    </div>
                    <Bar value={s.score} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {report.competencies?.length > 0 && (
            <Card title="Overall areas">
              <div className="col" style={{ gap: 16 }}>
                {report.competencies.map((c) => (
                  <div key={c.key}>
                    <div className="between" style={{ marginBottom: 5 }}>
                      <span>
                        <strong>{c.label}</strong>
                        <span className="dim small"> · {Math.round(c.weight * 100)}% of the score</span>
                      </span>
                      <span className="tabular">{c.score == null ? <span className="dim">not assessed</span> : `${c.score}/100`}</span>
                    </div>
                    <Bar value={c.score ?? 0} />
                    {c.evidence.length > 0 && (
                      <div className="col" style={{ gap: 5, marginTop: 8 }}>
                        {c.evidence.slice(0, 2).map((e, i) => <div key={i} className="quote">“{e}”</div>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {hasInterview && (plan.rules.mode === 'video' || plan.rules.mode === 'voice') && (
            <Card title="Recording">
              <RecordingPlayer
                session={session} videoRef={videoRef}
                filename={`${plan.job_context?.reference ?? 'interview'}-${name.replace(/\s+/g, '_')}`}
              />
            </Card>
          )}

          {hasInterview && (
            <Card title="Questions and answers">
              <div className="col" style={{ gap: 14 }}>
                {report.per_question.map((p, i) => {
                  const offset = offsetOf(p.question_id)
                  return (
                    <div key={p.question_id} className="card">
                      <div className="card-body tight">
                        <div className="between" style={{ alignItems: 'flex-start' }}>
                          <strong style={{ flex: 1 }}>Q{i + 1}. {p.question}</strong>
                          <span className="badge lg" style={{ flex: 'none', marginLeft: 10 }}>
                            {p.answered ? `${p.score * 2}/10` : 'not answered'}
                          </span>
                        </div>
                        {answersFor(p.question_id).filter((t) => t.kind !== 'question').map((t) => (
                          <div key={t.seq} className={t.role === 'candidate' ? 'answer' : 'followup'}>
                            <span className="who">{t.role === 'candidate' ? 'Answer' : 'Follow-up'}</span> {t.text}
                          </div>
                        ))}
                        <div className="small muted" style={{ marginTop: 6 }}>{p.rationale}</div>
                        {(p.covered_points?.length > 0 || p.missed_points?.length > 0) && (
                          <div className="row wrap" style={{ gap: 4, marginTop: 8 }}>
                            {p.covered_points.map((x) => <span key={x} className="chip on">✓ {x}</span>)}
                            {p.missed_points.map((x) => <span key={x} className="chip">✕ {x}</span>)}
                          </div>
                        )}
                        {offset != null && (
                          <button className="btn ghost sm no-print" style={{ paddingLeft: 0, marginTop: 6 }} onClick={() => seekTo(p.question_id)}>
                            ▶ Watch from {mmss(offset)}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </div>

        <div className="col">
          {report.communication && (
            <Card title="Communication">
              <div className="col" style={{ gap: 12 }}>
                {[
                  ['fluency', 'Fluency', 'Speaks in full, connected answers'],
                  ['confidence', 'Confidence', 'Answers directly, without hedging'],
                  ['clarity', 'Clarity', 'Easy to follow'],
                ].map(([k, label, hint]) => (
                  <div key={k}>
                    <div className="between" style={{ marginBottom: 4 }}>
                      <span><strong>{label}</strong> <span className="dim small">· {hint}</span></span>
                      <span className="tabular">{Math.round(report.communication[k] / 10)}/10</span>
                    </div>
                    <Bar value={report.communication[k]} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {report.qualification && (
            <Card title="Questionnaire">
              <div className="col" style={{ gap: 8 }}>
                {report.qualification.rows.map((r) => (
                  <div key={r.id} className={`qa ${r.knocked ? 'knocked' : ''}`}>
                    <div className="small muted">{r.text}</div>
                    <div><strong>{r.answered ? String(r.answer) === 'yes' ? 'Yes' : String(r.answer) === 'no' ? 'No' : r.answer : '—'}</strong>{r.knocked && <Badge tone="warn" style={{ marginLeft: 6 }}>outside requirement</Badge>}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {hasInterview && (
            <Card title="Integrity">
              {integrity.auto_terminated && (
                <div className="note bad small mb"><strong>Ended automatically</strong> — {integrity.reason}.</div>
              )}
              <dl className="kv small">
                {INTEGRITY.map(([k, label]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{label}</dt>
                    <dd className="tabular">{(integrity[k] ?? 0) > 0 ? <strong style={{ color: 'var(--warn)' }}>{integrity[k]}×</strong> : '0'}</dd>
                  </div>
                ))}
              </dl>
              {(session.violations ?? []).length > 0 && (
                <details className="mt">
                  <summary className="small">When it happened</summary>
                  <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {session.violations.map((v, i) => (
                      <li key={i}>
                        {INTEGRITY.find(([k]) => k === v.kind)?.[1] ?? v.kind} — during Q{(v.question_index ?? 0) + 1}
                        {session.started_at && ` at ${mmss((new Date(v.at) - new Date(session.started_at)) / 1000)}`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="hint mt">Recorded, not scored. Look at the video before deciding.</div>
            </Card>
          )}

          <Card title="Candidate">
            <dl className="kv">
              <dt>Experience</dt>
              <dd>{plan.candidate_context?.total_experience_years != null ? `${plan.candidate_context.total_experience_years} years` : '—'}</dd>
              <dt>Current</dt>
              <dd>{[plan.candidate_context?.current?.title, plan.candidate_context?.current?.company].filter(Boolean).join(' at ') || '—'}</dd>
              {candidate && (
                <>
                  <dt>Notice</dt>
                  <dd>{candidate.notice_period_days == null ? '—' : candidate.notice_period_days === 0 ? 'Immediate' : `${candidate.notice_period_days} days`}</dd>
                  <dt>Current CTC</dt><dd>{lpa(candidate.current_ctc_lpa)}</dd>
                  <dt>Expected CTC</dt><dd>{lpa(candidate.expected_ctc_lpa)}</dd>
                  <dt>Location</dt><dd>{candidate.location?.city ?? '—'}</dd>
                  {!isPublic && <><dt>Phone</dt><dd>{candidate.phone ?? '—'}</dd></>}
                </>
              )}
            </dl>
          </Card>

          <Card title="Strengths">
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {report.strengths.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </Card>

          <Card title="Concerns">
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {report.concerns.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </Card>

          <Card title="Ask in the next round">
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {report.follow_up_questions.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </Card>
        </div>
      </div>

      {candidate?.resume_text && (
        <Card title="CV">
          <div className="pre cv">{candidate.resume_text}</div>
        </Card>
      )}
    </div>
  )
}
