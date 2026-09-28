import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Badge, Tabs, Select, Empty } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { getJob, setJobStatus, setPublished } from '../../../services/jobs.js'
import { listApplications } from '../../../services/applications.js'
import { activityFor } from '../../../services/core.js'
import { JOB_STATUSES, JOB_STATUS_LABEL, languageByCode } from '../../../domain/locations.js'
import { formatDateTime, lpa } from '../../../lib/format.js'
import Pipeline from './Pipeline.jsx'
import InterviewSetup from './InterviewSetup.jsx'
import AddCandidates from './AddCandidates.jsx'
import CareerPortalTest from './CareerPortalTest.jsx'

export default function JobDetail() {
  const { id } = useParams()
  const toast = useToast()
  const [tab, setTab] = useState('pipeline')
  const [adding, setAdding] = useState(false)

  const data = useLive(
    () => {
      const job = getJob(id)
      if (!job) return { job: null }
      return {
        job,
        applications: listApplications({ job_id: id }),
        activity: activityFor('job', id),
      }
    },
    [id],
  )

  if (!data.job) {
    return (
      <>
        <div className="topbar"><h1>Job not found</h1></div>
        <div className="page"><Card><Empty title="This job no longer exists" action={<Link className="btn" to="/jobs">Back to jobs</Link>} /></Card></div>
      </>
    )
  }

  const { job, applications, activity } = data

  return (
    <>
      <div className="topbar">
        <div style={{ minWidth: 0 }}>
          <div className="row">
            <code className="mono dim">{job.reference}</code>
            <h1 className="truncate">{job.title}</h1>
          </div>
          <div className="small muted row wrap" style={{ gap: 6 }}>
            <span>{job.department_name} · {job.location.city} · {job.location.mode} · {job.openings} opening{job.openings === 1 ? '' : 's'}</span>
            {job.publish?.career_portal && job.status === 'active' && <Badge tone="good">On career page</Badge>}
            {job.publish?.linkedin && <Badge tone="info">LinkedIn</Badge>}
          </div>
        </div>
        <div className="spacer" />
        <Select
          options={JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABEL[s] }))}
          value={job.status} style={{ width: 130 }}
          aria-label="Job status"
          onChange={(v) => { setJobStatus(job._id, v); toast(`${job.reference} is now ${JOB_STATUS_LABEL[v].toLowerCase()}.`) }}
        />
        <Link className="btn" to={`/jobs/${job._id}/edit`}>Edit job</Link>
        <button className="btn primary" onClick={() => setAdding(true)}>Add candidates</button>
      </div>

      <div className="page wide">
        <Tabs
          value={tab} onChange={setTab}
          tabs={[
            { key: 'pipeline', label: 'Pipeline', count: applications.length },
            { key: 'description', label: 'Job description' },
            { key: 'interview', label: 'Interview setup' },
            { key: 'activity', label: 'Activity', count: activity.length },
          ]}
        />

        <div style={{ marginTop: 18 }}>
          {tab === 'pipeline' && <Pipeline job={job} applications={applications} onAdd={() => setAdding(true)} />}
          {tab === 'description' && <Description job={job} />}
          {tab === 'interview' && <InterviewSetup job={job} />}
          {tab === 'activity' && <Activity rows={activity} />}
        </div>
      </div>

      {adding && <AddCandidates job={job} onClose={() => setAdding(false)} />}
    </>
  )
}

function Publishing({ job }) {
  const toast = useToast()
  const [testing, setTesting] = useState(false)
  const live = job.status === 'active'
  const onPortal = Boolean(job.publish?.career_portal)
  return (
    <Card title="Where this job is advertised">
      <label className="check">
        <input
          type="checkbox" checked={onPortal}
          onChange={(e) => { setPublished(job._id, 'career_portal', e.target.checked); toast(e.target.checked ? 'Sent to the official career page.' : 'Removed from the official career page.') }}
        />
        <span>
          Official career page
          <span className="hint" style={{ display: 'block' }}>
            {onPortal
              ? live ? 'Listed. Everyone who applies there appears in this pipeline, with their resume, tagged “Career portal”.' : 'Will be listed once the job is active.'
              : 'Not listed.'}
          </span>
        </span>
      </label>
      {onPortal && live && (
        <button className="btn sm" style={{ marginLeft: 26, marginBottom: 10 }} onClick={() => setTesting(true)}>
          Test: simulate an application
        </button>
      )}
      <label className="check">
        <input
          type="checkbox" checked={Boolean(job.publish?.linkedin)}
          onChange={(e) => { setPublished(job._id, 'linkedin', e.target.checked); toast(e.target.checked ? 'Marked for LinkedIn.' : 'Unmarked for LinkedIn.') }}
        />
        <span>
          LinkedIn
          <span className="hint" style={{ display: 'block' }}>Marked for posting. Posting itself needs the LinkedIn connection (backend).</span>
        </span>
      </label>
      <div className="hint">Naukri is not supported for posting — its API is paid. Pull Naukri profiles in with the Chrome extension instead.</div>
      {testing && <CareerPortalTest job={job} onClose={() => setTesting(false)} />}
    </Card>
  )
}

function Description({ job }) {
  return (
    <div className="grid split">
      <Card title="Job description">
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{job.description}</div>
      </Card>

      <div className="col">
        <Publishing job={job} />
        <Card title="Requirements">
          {job.primary_skill && (
            <>
              <h4>Primary skill</h4>
              <div className="row wrap" style={{ gap: 5, margin: '6px 0 14px' }}>
                <span className="chip on">★ {job.primary_skill}</span>
                {job.primary_skill_min_years != null && <span className="small muted">at least {job.primary_skill_min_years} years</span>}
              </div>
            </>
          )}
          <h4>Key skills</h4>
          <div className="row wrap" style={{ gap: 5, margin: '6px 0 14px' }}>
            {job.skills_required.map((s) => <span key={s} className="chip on">{s}</span>)}
          </div>
          <h4>Nice to have</h4>
          <div className="row wrap" style={{ gap: 5, marginTop: 6 }}>
            {job.skills_preferred.length
              ? job.skills_preferred.map((s) => <span key={s} className="chip">{s}</span>)
              : <span className="dim small">None</span>}
          </div>
        </Card>

        <Card title="Details">
          <dl className="kv">
            <dt>Experience</dt>
            <dd>{job.experience.min_years}–{job.experience.max_years} years · {job.experience.level}</dd>
            <dt>Compensation</dt>
            <dd>
              {job.compensation.min_lpa ? `${lpa(job.compensation.min_lpa)} – ${lpa(job.compensation.max_lpa)}` : '—'}
              {job.compensation.disclosed ? <Badge tone="good" style={{ marginLeft: 6 }}>shown</Badge> : <Badge style={{ marginLeft: 6 }}>hidden</Badge>}
            </dd>
            <dt>Employment</dt><dd>{job.employment_type}</dd>
            <dt>AI suggestion bar</dt>
            <dd>
              <strong>{job.screening_profile.match_threshold}%</strong>
              <div className="small dim">Resumes above this are suggested as a good fit.</div>
            </dd>
            <dt>Interview language</dt><dd>{languageByCode(job.interview_language_default).label} <span className="dim small">(default)</span></dd>
            <dt>Owner</dt><dd>{job.owner_username}</dd>
            <dt>Created</dt><dd>{formatDateTime(job.created_at)}</dd>
          </dl>
        </Card>
      </div>
    </div>
  )
}

function Activity({ rows }) {
  if (!rows.length) return <Card><Empty title="No activity yet" /></Card>
  return (
    <Card>
      <div className="col" style={{ gap: 12 }}>
        {rows.map((a) => (
          <div key={a._id} className="between">
            <div>
              <div>{a.summary}</div>
              <div className="small dim">{a.by} · {formatDateTime(a.at)}</div>
            </div>
            <span className="chip">{a.type}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
