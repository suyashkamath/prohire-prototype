import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Badge, Empty, Select, Match, Stat, Bar } from '../../../components/ui/index.jsx'
import { listReports } from '../../../services/interviews.js'
import { listApplications } from '../../../services/applications.js'
import { listJobs } from '../../../services/jobs.js'
import { FUNNEL } from '../../../domain/stages.js'
import { relative } from '../../../lib/format.js'

export default function ReportsPage() {
  const navigate = useNavigate()
  const [jobId, setJobId] = useState('')

  const data = useLive(
    () => {
      const jobs = listJobs()
      const apps = listApplications({ job_id: jobId || undefined })
      const reports = listReports({ job_id: jobId || undefined })
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

        <div className="grid split">
          <Card title="Hiring funnel">
            <div className="col" style={{ gap: 14 }}>
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
            <p className="small muted" style={{ marginTop: 14 }}>
              Each row counts applications <em>currently</em> at that stage, not everyone who has ever
              passed through it — so the bars are a snapshot, not a cumulative funnel.
            </p>
          </Card>

          <Card title="Interview reports">
            {data.reports.length === 0 ? (
              <Empty title="No reports yet">Reports appear here once candidates complete their interviews.</Empty>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {data.reports.map((r) => (
                  <div key={r._id} className="card clickable" onClick={() => navigate(`/interviews/${r.session_id}`)}>
                    <div className="card-body tight between">
                      <div style={{ minWidth: 0 }}>
                        <strong className="truncate">{r.headline}</strong>
                        <div className="small dim">
                          {relative(r.generated_at)} · {r.signals.coverage.questions_answered}/{r.signals.coverage.questions_planned} answered
                        </div>
                      </div>
                      <div className="row" style={{ flex: 'none' }}>
                        {r.recruiter_verdict ? (
                          <Badge tone={r.recruiter_verdict.agreed_with_ai ? 'good' : 'warn'}>
                            {r.recruiter_verdict.agreed_with_ai ? 'agreed' : 'overridden'}
                          </Badge>
                        ) : (
                          <Badge tone="accent">undecided</Badge>
                        )}
                        <Match value={r.overall_score} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

function avg(xs) {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null
}
