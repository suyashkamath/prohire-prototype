import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Stat, Badge, Empty, Match } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { listJobs } from '../../../services/jobs.js'
import { listApplications } from '../../../services/applications.js'
import { listSessions, listReports } from '../../../services/interviews.js'
import { recentActivity } from '../../../services/core.js'

import { relative } from '../../../lib/format.js'
import { seed, isSeeded } from '../../../lib/seed.js'

// Light or dark, for the Dashboard only. The rest of the console follows the
// computer's setting. The choice is remembered in this browser; with none
// saved, the Dashboard follows the computer too.
const THEME_KEY = 'prohire.v2.dashboard_theme'

function savedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

const systemTheme = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

function useDashboardTheme() {
  const [theme, setTheme] = useState(() => savedTheme() ?? systemTheme())

  // Applied while the Dashboard is on screen; leaving it hands back to the system.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme
    return () => {
      delete root.dataset.theme
      root.style.colorScheme = ''
    }
  }, [theme])

  const choose = (t) => {
    setTheme(t)
    try { localStorage.setItem(THEME_KEY, t) } catch { /* private window: this visit only */ }
  }
  return [theme, choose]
}

function ThemeSwitch({ theme, onChange }) {
  return (
    <div className="seg" role="group" aria-label="Dashboard theme">
      <button className={theme === 'light' ? 'on' : ''} aria-pressed={theme === 'light'} onClick={() => onChange('light')}>☀ Light</button>
      <button className={theme === 'dark' ? 'on' : ''} aria-pressed={theme === 'dark'} onClick={() => onChange('dark')}>☾ Dark</button>
    </div>
  )
}

/**
 * Counts that lead to a click — not a metrics wall.
 *
 * Every number here is a to-do: something a recruiter can act on this morning.
 * A count with no action behind it is decoration.
 */
export default function Dashboard() {
  const navigate = useNavigate()
  const toast = useToast()
  const [seeding, setSeeding] = useState(null)
  const [theme, setTheme] = useDashboardTheme()

  const data = useLive(() => {
    const jobs = listJobs({ status: 'active' })
    const apps = listApplications()
    const sessions = listSessions()
    const reports = listReports()
    return {
      empty: !isSeeded(),
      openJobs: jobs.length,
      openings: jobs.reduce((s, j) => s + j.openings, 0),
      toScreen: apps.filter((a) => !a.screening),
      awaitingInvite: apps.filter((a) => a.screening?.decision === 'Shortlisted' && ['sourced', 'screened', 'interested'].includes(a.stage)),
      liveInvites: sessions.filter((s) => s.state === 'invited'),
      inProgress: sessions.filter((s) => s.state === 'in_progress'),
      unread: reports.filter((r) => !r.recruiter_verdict),
      activity: recentActivity(12),
      topJobs: listJobs({ status: 'active' }).slice(0, 4),
    }
  })

  async function runSeed() {
    setSeeding('Starting…')
    try {
      const out = await seed({ onProgress: setSeeding })
      toast(`Loaded ${out.candidates} candidates across ${out.jobs} jobs.`, 'good')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setSeeding(null)
    }
  }

  if (data.empty) {
    return (
      <>
        <div className="topbar">
          <h1>Dashboard</h1>
          <div className="spacer" />
          <ThemeSwitch theme={theme} onChange={setTheme} />
        </div>
        <div className="page">
          <Card>
            <Empty
              title="Nothing here yet"
              action={
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="btn primary" onClick={runSeed} disabled={Boolean(seeding)}>
                    {seeding ? seeding : 'Load demo data'}
                  </button>
                  <Link className="btn" to="/departments">Start from scratch</Link>
                </div>
              }
            >
              Load the demo world — two departments, three jobs and six candidates, screened by the
              real engine — or create your first department and build it up yourself.
              Everything is stored in this browser.
            </Empty>
          </Card>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="topbar">
        <h1>Dashboard</h1>
        <div className="spacer" />
        <ThemeSwitch theme={theme} onChange={setTheme} />
        <Link className="btn primary" to="/jobs/new">New job</Link>
      </div>

      <div className="page">
        <div className="grid c4">
          <Stat value={data.openJobs} label={`Open jobs · ${data.openings} positions`} onClick={() => navigate('/jobs')} />
          <Stat
            value={data.toScreen.length}
            label="Waiting to be screened"
            tone={data.toScreen.length ? 'warn' : undefined}
            onClick={() => navigate('/candidates')}
          />
          <Stat
            value={data.inProgress.length + data.liveInvites.length}
            label={`${data.inProgress.length} live · ${data.liveInvites.length} invited`}
            onClick={() => navigate('/interviews')}
          />
          <Stat
            value={data.unread.length}
            label="Reports awaiting your call"
            tone={data.unread.length ? 'accent' : undefined}
            onClick={() => navigate('/reports')}
          />
        </div>

        <div className="grid split mt">
          <div className="col">
            {data.unread.length > 0 && (
              <Card title="Reports awaiting your decision" actions={<Link className="btn sm" to="/reports">All reports</Link>}>
                <div className="col" style={{ gap: 8 }}>
                  {data.unread.slice(0, 5).map((r) => (
                    <ReportRow key={r._id} report={r} onClick={() => navigate(`/interviews/${r.session_id}`)} />
                  ))}
                </div>
              </Card>
            )}

            {data.awaitingInvite.length > 0 && (
              <Card
                title="Screened and shortlisted — not yet invited"
                actions={<span className="badge accent">{data.awaitingInvite.length}</span>}
              >
                <p className="small muted">
                  The AI put these above the bar. Inviting them is your call, not its.
                </p>
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {data.awaitingInvite.slice(0, 6).map((a) => (
                        <tr key={a._id} className="clickable" onClick={() => navigate(`/jobs/${a.job_id}`)}>
                          <td><strong>{a.candidate_name}</strong></td>
                          <td className="muted small">{a.job_reference} · {a.job_title}</td>
                          <td className="num"><Match value={a.screening?.match_percent} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <Card title="Your jobs" actions={<Link className="btn sm" to="/jobs">All jobs</Link>}>
              <div className="col" style={{ gap: 10 }}>
                {data.topJobs.map((j) => (
                  <div key={j._id} className="card clickable" onClick={() => navigate(`/jobs/${j._id}`)}>
                    <div className="card-body tight between">
                      <div style={{ minWidth: 0 }}>
                        <div className="row">
                          <code className="mono dim">{j.reference}</code>
                          <strong className="truncate">{j.title}</strong>
                        </div>
                        <div className="small muted">
                          {j.department_name} · {j.location.city} · {j.openings} opening{j.openings === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="small muted tabular" style={{ textAlign: 'right', flex: 'none' }}>
                        {j.stats.applicants} applied<br />
                        {j.stats.interviewed} interviewed · {j.stats.shortlisted} shortlisted
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Recent activity">
            {data.activity.length === 0 ? (
              <p className="small muted">Nothing yet.</p>
            ) : (
              <div className="col" style={{ gap: 11 }}>
                {data.activity.map((a) => (
                  <div key={a._id} className="small">
                    <div>{a.summary}</div>
                    <div className="dim" style={{ fontSize: 12 }}>
                      {a.by} · {relative(a.at)}
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

function ReportRow({ report, onClick }) {
  const tone = { shortlist: 'good', hold: 'warn', reject: 'bad' }[report.recommendation]
  return (
    <div className="card clickable" onClick={onClick}>
      <div className="card-body tight between">
        <div style={{ minWidth: 0 }}>
          <strong>{report.headline}</strong>
          <div className="small muted truncate">
            {report.signals.coverage.questions_answered}/{report.signals.coverage.questions_planned} answered
            · {relative(report.generated_at)}
          </div>
        </div>
        <div className="row" style={{ flex: 'none' }}>
          <Badge tone={tone}>AI: {report.recommendation}</Badge>
          <Match value={report.overall_score} />
        </div>
      </div>
    </div>
  )
}
