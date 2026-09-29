import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Badge, Empty, Select, Match, Stat, Bar } from '../../../components/ui/index.jsx'
import { listReports, getSession } from '../../../services/interviews.js'
import { listApplications } from '../../../services/applications.js'
import { listJobs } from '../../../services/jobs.js'
import { FUNNEL } from '../../../domain/stages.js'
import { relative, formatDate } from '../../../lib/format.js'

// The AI's suggestion, in the same words the report itself uses.
const REC = {
  shortlist: { label: 'Recommended', tone: 'good' },
  hold: { label: 'Hold — review', tone: 'warn' },
  reject: { label: 'Not recommended', tone: 'bad' },
}

export default function ReportsPage() {
  const navigate = useNavigate()
  const [jobId, setJobId] = useState('')

  const data = useLive(
    () => {
      const jobs = listJobs()
      const apps = listApplications({ job_id: jobId || undefined })
      // Each report with who and what it is for, taken from the session's
      // frozen plan so a deleted job or candidate still reads correctly.
      const reports = listReports({ job_id: jobId || undefined }).map((r) => {
        const plan = getSession(r.session_id)?.plan
        return {
          ...r,
          candidate_name: plan?.candidate_context?.full_name ?? 'Candidate',
          job_reference: plan?.job_context?.reference,
          job_title: plan?.job_context?.title,
        }
      })
      const decided = reports.filter((r) => r.recruiter_verdict)

      return {
        jobs,
        reports,
        funnel: FUNNEL.map((f) => ({ ...f, count: apps.filter((a) => a.stage === f.key).length })),
        totalApps: apps.length,
        screened: apps.filter((a) => a.screening).length,
        avgMatch: avg(apps.filter((a) => a.screening).map((a) => a.screening.match_percent)),
        avgInterview: avg(reports.map((r) => r.overall_score)),
        // The report-trust metric: a single boolean, aggregated. It is the
        // cheapest honest measure of whether the AI is earning its place.
        agreement: decided.length
          ? Math.round((decided.filter((r) => r.recruiter_verdict.agreed_with_ai).length / decided.length) * 100)
          : null,
        decidedCount: decided.length,
      }
    },
    [jobId],
  )

  return (
    <>
      <div className="topbar">
        <h1>Reports</h1>
        <div className="spacer" />
        <Select
          options={data.jobs.map((j) => ({ value: j._id, label: `${j.reference} · ${j.title}` }))}
          value={jobId} onChange={setJobId} placeholder="All jobs" style={{ width: 240 }}
        />
      </div>

      <div className="page">
        <div className="grid c4 mb">
          <Stat value={data.totalApps} label="Applications" />
          <Stat value={data.avgMatch == null ? '—' : `${data.avgMatch}%`} label={`Average match · ${data.screened} screened`} />
          <Stat value={data.avgInterview == null ? '—' : data.avgInterview} label={`Average interview score · ${data.reports.length} reports`} />
          <Stat
            value={data.agreement == null ? '—' : `${data.agreement}%`}
            label={`Recruiters agreed with the AI · ${data.decidedCount} decided`}
            tone={data.agreement != null && data.agreement < 50 ? 'warn' : undefined}
          />
        </div>

        {data.agreement != null && data.agreement < 50 && (
          <div className="note warn mb">
            Recruiters are overriding the AI more often than not. That is the signal to look at the
            thresholds and the question set — not to ignore the number.
          </div>
        )}

        <Card
          title="Interview reports"
          actions={data.reports.length > 0 && <span className="small muted">{data.reports.length} report{data.reports.length === 1 ? '' : 's'} · newest first</span>}
          className="mb"
        >
          {data.reports.length === 0 ? (
            <Empty title="No reports yet">Reports appear here once candidates complete their interviews.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table reports-table">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Interviewed</th>
                    <th className="num">Answered</th>
                    <th>Integrity</th>
                    <th className="num">Score</th>
                    <th>AI suggests</th>
                    <th>Your decision</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reports.map((r) => {
                    const rec = REC[r.recommendation] ?? REC.hold
                    const events = r.integrity?.total ?? 0
                    const { questions_answered: answered, questions_planned: planned } = r.signals?.coverage ?? {}
                    return (
                      <tr key={r._id} className="clickable" onClick={() => navigate(`/interviews/${r.session_id}`)}>
                        <td className="report-who">
                          <strong>{r.candidate_name}</strong>
                          <div className="small muted">
                            {r.job_reference && <code className="mono dim">{r.job_reference}</code>} {r.job_title}
                          </div>
                          {r.headline && <div className="small dim truncate" title={r.headline}>{r.headline}</div>}
                        </td>
                        <td className="small" data-label="Interviewed">
                          {formatDate(r.generated_at)}
                          <div className="dim">{relative(r.generated_at)}</div>
                        </td>
                        <td className="num" data-label="Answered">{answered ?? '—'}<span className="dim">/{planned ?? '—'}</span></td>
                        <td data-label="Integrity">
                          {events > 0
                            ? <Badge tone={r.integrity?.level === 'high' ? 'bad' : 'warn'}>⚠ {events} event{events === 1 ? '' : 's'}</Badge>
                            : <span className="dim small">None</span>}
                        </td>
                        <td className="num" data-label="Score"><Match value={r.overall_score} /></td>
                        <td data-label="AI suggests">
                          <Badge tone={rec.tone}>{rec.label}</Badge>
                          {r.confidence === 'low' && <div className="small dim" style={{ marginTop: 3 }}>low confidence</div>}
                        </td>
                        <td data-label="Your decision">
                          {r.recruiter_verdict ? (
                            <>
                              <span className="verdict">{{ shortlist: 'Shortlisted', hold: 'On hold', reject: 'Rejected' }[r.recruiter_verdict.decision] ?? r.recruiter_verdict.decision}</span>
                              <div className="small dim">{r.recruiter_verdict.agreed_with_ai ? 'agreed with AI' : 'overrode AI'}</div>
                            </>
                          ) : (
                            <Badge tone="accent">Not decided</Badge>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Hiring funnel">
          <div className="funnel-rows">
            {data.funnel.map((f) => (
              <div key={f.key}>
                <div className="between" style={{ marginBottom: 4 }}>
                  <span>{f.label}</span>
                  <span className="tabular">
                    {f.count}
                    {data.totalApps > 0 && <span className="dim"> · {Math.round((f.count / data.totalApps) * 100)}%</span>}
                  </span>
                </div>
                <Bar value={data.totalApps ? (f.count / data.totalApps) * 100 : 0} tone="" />
              </div>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 14, marginBottom: 0 }}>
            Each row counts applications <em>currently</em> at that stage, not everyone who has ever
            passed through it — so the bars are a snapshot, not a cumulative funnel.
          </p>
        </Card>
      </div>
    </>
  )
}

function avg(xs) {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null
}
