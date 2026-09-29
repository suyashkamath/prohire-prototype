import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'

import { currentUser, signIn, signOut } from '../services/core.js'
import { sweepExpired, openBotSessions, syncOpenBotSessions } from '../services/interviews.js'
import { listApplications } from '../services/applications.js'
import { listSessions } from '../services/interviews.js'
import { useLive } from '../components/ui/useLive.js'
import { Field } from '../components/ui/index.jsx'
import { ProHireMark } from '../components/Brand.jsx'

import Dashboard from './features/dashboard/Dashboard.jsx'
import DepartmentsPage from './features/departments/DepartmentsPage.jsx'
import JobsPage from './features/jobs/JobsPage.jsx'
import JobDetail from './features/jobs/JobDetail.jsx'
import NewJob, { EditJob } from './features/jobs/NewJob.jsx'
import CandidatesPage from './features/candidates/CandidatesPage.jsx'
import CandidateDetail from './features/candidates/CandidateDetail.jsx'
import InterviewsPage from './features/interviews/InterviewsPage.jsx'
import SessionDetail from './features/interviews/SessionDetail.jsx'
import ReportsPage from './features/reports/ReportsPage.jsx'
import SettingsPage from './features/settings/SettingsPage.jsx'
import ImportPage from './features/candidates/ImportPage.jsx'

export default function ConsoleApp() {
  const [user, setUser] = useState(() => currentUser())

  // Expiry is a state transition performed by a sweep, not a TTL delete —
  // an expired invite must stay visible (§9.7). The real system runs this on a
  // schedule; here it runs when the console opens, which is the same idea.
  useEffect(() => {
    if (user) sweepExpired()
  }, [user])

  // AI voice calls run on the InterviewBot server. While the console is open,
  // it checks the open ones every 15 seconds: started, finished, report ready.
  useEffect(() => {
    if (!user) return
    let busy = false
    const tick = async () => {
      if (busy || !openBotSessions().length) return
      busy = true
      try { await syncOpenBotSessions() } finally { busy = false }
    }
    tick()
    const t = setInterval(tick, 15000)
    return () => clearInterval(t)
  }, [user])

  if (!user) return <SignIn onSignedIn={setUser} />

  return (
    <div className="shell">
      <Sidebar user={user} onSignOut={() => { signOut(); setUser(null) }} />
      <div className="main">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/new" element={<NewJob />} />
          <Route path="jobs/:id" element={<JobDetail />} />
          <Route path="jobs/:id/edit" element={<EditJob />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="candidates" element={<CandidatesPage />} />
          <Route path="candidates/:id" element={<CandidateDetail />} />
          <Route path="interviews" element={<InterviewsPage />} />
          <Route path="interviews/:id" element={<SessionDetail />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  )
}

function Sidebar({ user, onSignOut }) {
  // Six destinations, not twelve. The counts are the ones that lead to a click.
  const counts = useLive(() => {
    const apps = listApplications()
    return {
      needsScreening: apps.filter((a) => !a.screening && a.stage === 'sourced').length,
      awaitingReview: apps.filter((a) => a.stage === 'interview_completed').length,
      liveInterviews: listSessions({ state: ['invited', 'in_progress'] }).length,
    }
  })

  return (
    <nav className="sidebar">
      <div className="brand">
        <ProHireMark size={28} />
        ProHire
      </div>

      <NavLink to="/" end className={navClass}>Dashboard</NavLink>
      <NavLink to="/jobs" className={navClass}>Jobs</NavLink>
      <NavLink to="/candidates" className={navClass}>
        Candidates
        {counts.needsScreening > 0 && <span className="nav-count">{counts.needsScreening} to screen</span>}
      </NavLink>
      <NavLink to="/interviews" className={navClass}>
        Interviews
        {counts.liveInterviews > 0 && <span className="nav-count">{counts.liveInterviews}</span>}
      </NavLink>
      <NavLink to="/reports" className={navClass}>
        Reports
        {counts.awaitingReview > 0 && <span className="nav-count">{counts.awaitingReview} new</span>}
      </NavLink>
      <NavLink to="/departments" className={navClass}>Departments</NavLink>

      <div className="sidebar-foot">
        <NavLink to="/settings" className={navClass}>Settings</NavLink>
        <div className="row" style={{ padding: '10px 10px 0' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{user.full_name}</div>
            <button className="btn ghost sm" style={{ padding: 0 }} onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </div>
    </nav>
  )
}

const navClass = ({ isActive }) => `nav-item ${isActive ? 'active' : ''}`

function SignIn({ onSignedIn }) {
  const [username, setUsername] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState(null)

  const submit = (e) => {
    e.preventDefault()
    try {
      // Stay on the URL they arrived at — a link from the Chrome extension
      // (/import#…) must survive the sign-in.
      onSignedIn(signIn({ username, remember }))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="interview-shell">
      <form className="interview-card" style={{ maxWidth: 420 }} onSubmit={submit}>
        <div className="interview-head">
          <ProHireMark size={34} />
          <div>
            <h2>ProHire</h2>
            <div className="small muted">Recruiter console</div>
          </div>
        </div>
        <div className="interview-body">
          <Field
            label="Your name"
            hint="Your name is recorded against everything you do — who created a job, who moved a candidate. (Prototype: no password yet.)"
            error={error}
          >
            <input
              type="text"
              value={username}
              autoFocus
              placeholder="asha"
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Stay signed in on this browser
          </label>
        </div>
        <div className="interview-foot">
          <button className="btn primary block lg" type="submit">Continue</button>
        </div>
      </form>
    </div>
  )
}
