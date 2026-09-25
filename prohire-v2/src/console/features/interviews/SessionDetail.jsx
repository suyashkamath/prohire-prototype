import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Badge, Tabs, Empty, Modal, CopyButton } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import {
  getSession, getReportForSession, recordVerdict, reportUrl, generateReport, endReasonLabel,
} from '../../../services/interviews.js'
import { getCandidate } from '../../../services/candidates.js'
import { formatDateTime } from '../../../lib/format.js'
import ReportView from '../../../components/ReportView.jsx'

export default function SessionDetail() {
  const { id } = useParams()
  const [tab, setTab] = useState('report')
  const [verdict, setVerdict] = useState(null)
  const [regenerating, setRegenerating] = useState(false)
  const toast = useToast()

  const data = useLive(
    () => {
      const session = getSession(id)
      if (!session) return { session: null }
      return {
        session,
        report: getReportForSession(id),
        candidate: getCandidate(session.candidate_id),
      }
    },
    [id],
  )

  if (!data.session) {
    return (
      <>
        <div className="topbar"><h1>Session not found</h1></div>
        <div className="page"><Card><Empty title="No such interview" action={<Link className="btn" to="/interviews">Back</Link>} /></Card></div>
      </>
    )
  }

  const { session, report, candidate } = data

  return (
    <>
      <div className="topbar">
        <div style={{ minWidth: 0 }}>
          <h1 className="truncate">{session.plan.candidate_context?.full_name}</h1>
          <div className="small muted">
            <code className="mono dim">{session.plan.job_context?.reference}</code>{' '}
            {session.plan.job_context?.title} · attempt {session.attempt}
          </div>
        </div>
        <div className="spacer" />
        {report && <CopyButton text={reportUrl(report.share_token)} label="Copy share link" className="btn no-print" />}
        {report && <a className="btn no-print" href={reportUrl(report.share_token)} target="_blank" rel="noreferrer">Open shared view</a>}
        {report && <button className="btn no-print" onClick={() => { setTab('report'); setTimeout(() => window.print(), 50) }}>Download PDF</button>}
        <Link className="btn no-print" to={`/jobs/${session.job_id}`}>Open job</Link>
      </div>

      <div className="page wide">
        {report?.recruiter_verdict ? (
          <div className="note good mb">
            <strong>{report.recruiter_verdict.by}</strong> decided{' '}
            <strong>{report.recruiter_verdict.decision}</strong>{' '}
            {formatDateTime(report.recruiter_verdict.at)}
            {report.recruiter_verdict.agreed_with_ai
              ? ' — agreeing with the AI.'
              : ' — overriding the AI recommendation.'}
            {report.recruiter_verdict.note && <div style={{ marginTop: 4 }}>“{report.recruiter_verdict.note}”</div>}
          </div>
        ) : report ? (
          <div className="note mb between no-print">
            <span>
              <strong>Your call.</strong> The AI suggests <strong>{{ shortlist: 'recommended', hold: 'hold', reject: 'not recommended' }[report.recommendation]}</strong>
              {report.overall_score != null && <> at {report.overall_score}/100</>}. You decide.
            </span>
            <div className="row" style={{ flex: 'none' }}>
              <button className="btn primary sm" onClick={() => setVerdict('shortlist')}>Shortlist</button>
              <button className="btn sm" onClick={() => setVerdict('hold')}>Hold</button>
              <button className="btn danger sm" onClick={() => setVerdict('reject')}>Reject</button>
            </div>
          </div>
        ) : session.state === 'in_progress' ? (
          <div className="note warn mb">
            This interview is in progress. The report is written once it finishes.
          </div>
        ) : session.state === 'invited' ? (
          <div className="note info mb">
            Link sent {formatDateTime(session.invite.issued_at)}, not opened yet. It expires{' '}
            {formatDateTime(session.invite.expires_at)}.
            <div className="row mt"><CopyButton text={`${location.origin}/interview/${session.invite.token}`} label="Copy interview link" /></div>
          </div>
        ) : null}

        <div className="no-print">
          <Tabs
            value={tab} onChange={setTab}
            tabs={[
              { key: 'report', label: 'Report' },
              { key: 'transcript', label: 'Transcript', count: session.turns.length },
              { key: 'plan', label: 'Settings used' },
            ]}
          />
        </div>

        <div style={{ marginTop: 18 }}>
          {tab === 'report' && (
            report ? (
              <ReportView report={report} session={session} candidate={candidate} />
            ) : (
              <Card>
                <Empty
                  title="No report yet"
                  action={
                    session.turns.some((t) => t.role === 'candidate') && (
                      <button
                        className="btn primary" disabled={regenerating}
                        onClick={async () => {
                          setRegenerating(true)
                          await generateReport(session._id)
                          setRegenerating(false)
                          toast('Report generated.', 'good')
                        }}
                      >
                        {regenerating ? 'Scoring…' : 'Score what was answered'}
                      </button>
                    )
                  }
                >
                  {session.state === 'abandoned'
                    ? 'This session was abandoned. Whatever was answered can still be scored.'
                    : 'The report is written when the interview finishes.'}
                </Empty>
              </Card>
            )
          )}

          {tab === 'transcript' && <Transcript session={session} />}
          {tab === 'plan' && <FrozenPlan session={session} />}
        </div>
      </div>

      {verdict && report && (
        <VerdictDialog
          decision={verdict}
          report={report}
          onClose={() => setVerdict(null)}
          onDone={(d) => toast(`Recorded: ${d}.`, 'good')}
        />
      )}
    </>
  )
}

function Transcript({ session }) {
  if (!session.turns.length) {
    return <Card><Empty title="Nothing said yet" /></Card>
  }
  return (
    <Card>
      <div className="transcript">
        {session.turns.map((t) => (
          <div key={t.seq} className={`bubble ${t.role}`} style={{ maxWidth: '78%' }}>
            <span className="who">
              {t.role === 'interviewer' ? session.plan.persona.name : session.plan.candidate_context?.full_name}
              {t.kind === 'follow_up' && ' · follow-up'}
            </span>
            {t.text}
            {t.words != null && <div className="small dim" style={{ marginTop: 4 }}>{t.words} words</div>}
          </div>
        ))}
      </div>
    </Card>
  )
}

/**
 * The frozen plan, shown verbatim.
 *
 * This tab exists to make the freeze legible: what was actually asked, in which
 * language, under which rubric — snapshotted at invite time, even if the job has
 * changed since.
 */
function FrozenPlan({ session }) {
  const p = session.plan
  return (
    <div className="grid split">
      <Card title="Questions as frozen">
        <div className="note info mb">
          The questions and settings this candidate was sent on {formatDateTime(p.frozen_at)}. Changing
          the job since then does not change this interview or its report.
        </div>
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          {p.questions.map((q) => (
            <li key={q.id} style={{ marginBottom: 10 }}>
              <div>{q.text}</div>
              <div className="row wrap small dim" style={{ gap: 5, marginTop: 3 }}>
                <span className="chip">{q.type}</span>
                <span className="chip">{q.competency}</span>
                <span className="chip">weight {q.weight ?? 1}</span>
                {q.must_ask && <Badge tone="accent">must ask</Badge>}
                {q.expected_points?.length > 0 && <span className="chip">looking for: {q.expected_points.join(', ')}</span>}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="col">
        <Card title="Settings">
          <dl className="kv">
            <dt>Assessment</dt><dd>{(p.rules.assessment_type ?? 'interview').replace('qualification', 'questionnaire')}</dd>
            <dt>Format</dt><dd>{p.rules.mode}</dd>
            <dt>Language</dt><dd>{p.persona.language_label ?? p.rules.language}</dd>
            <dt>Duration</dt><dd>{p.rules.duration_minutes} min{p.rules.light_mode && ' (light mode)'}</dd>
            <dt>Strictness</dt><dd>{p.rules.strictness}</dd>
            <dt>Tab switches</dt><dd>{p.rules.proctoring?.auto_terminate === false ? 'warn only' : `end after ${p.rules.proctoring?.max_tab_switches ?? 3} warnings`}</dd>
            <dt>Ended</dt><dd>{session.end_reason ? endReasonLabel(session.end_reason) : '—'}</dd>
            <dt>Max questions</dt><dd>{p.rules.max_questions}</dd>
            <dt>Follow-ups</dt><dd>{p.rules.follow_ups_per_question} per question</dd>
            <dt>Shortlist at</dt><dd>{p.scoring.shortlist_threshold}</dd>
          </dl>
        </Card>

        <Card title="Job snapshot">
          <dl className="kv small">
            <dt>Reference</dt><dd>{p.job_context?.reference}</dd>
            <dt>Title</dt><dd>{p.job_context?.title}</dd>
            <dt>Skills</dt><dd>{p.job_context?.skills_required?.join(', ')}</dd>
          </dl>
          <p className="small dim" style={{ marginTop: 8 }}>
            Snapshotted at invite time. This report renders even if the job is deleted.
          </p>
        </Card>

        <Card title="Where the settings came from">
          <dl className="kv small">
            <dt>Company default</dt><dd>{p.resolved_from?.org_template_id ? '✓' : '—'}</dd>
            <dt>Department</dt><dd>{p.resolved_from?.dept_template_id ? '✓' : '—'}</dd>
            <dt>Job setup</dt><dd>{p.resolved_from?.job_template_id ? '✓' : '—'}</dd>
            <dt>This candidate</dt><dd>{p.resolved_from?.candidate_override ? '✓' : '—'}</dd>
            <dt>This invite</dt><dd>{p.resolved_from?.adhoc ? '✓' : '—'}</dd>
          </dl>
        </Card>
      </div>
    </div>
  )
}

function VerdictDialog({ decision, report, onClose, onDone }) {
  const [note, setNote] = useState('')
  const agrees = decision === report.recommendation

  return (
    <Modal
      title={`${decision[0].toUpperCase()}${decision.slice(1)} this candidate`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${decision === 'reject' ? 'danger' : 'primary'}`}
            onClick={() => { recordVerdict(report._id, decision, note); onDone(decision); onClose() }}
          >
            Confirm
          </button>
        </>
      }
    >
      {!agrees && (
        <div className="note warn mb">
          The AI recommended <strong>{report.recommendation}</strong>. You are overriding it — which is
          fine and expected. The disagreement is recorded, because how often recruiters override the
          AI is how we tell whether it is earning its place.
        </div>
      )}
      <div className="field">
        <label>Note (optional)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Why — for whoever reads this next." />
      </div>
      <p className="small muted">
        This also moves the application to{' '}
        <strong>{{ shortlist: 'Shortlisted', hold: 'On hold', reject: 'Rejected' }[decision]}</strong>.
      </p>
    </Modal>
  )
}
