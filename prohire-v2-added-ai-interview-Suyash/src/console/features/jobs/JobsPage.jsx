import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Badge, Empty, Select } from '../../../components/ui/index.jsx'
import { listJobs } from '../../../services/jobs.js'
import { listDepartments } from '../../../services/departments.js'
import { JOB_STATUSES, JOB_STATUS_LABEL } from '../../../domain/locations.js'
import { relative } from '../../../lib/format.js'

const STATUS_TONE = { draft: 'info', active: 'good', on_hold: 'warn', closed: '', cancelled: 'bad' }

export default function JobsPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('active')
  const [dept, setDept] = useState('')
  const [q, setQ] = useState('')

  const { jobs, departments } = useLive(
    () => ({
      jobs: listJobs({ status: status || undefined, department_id: dept || undefined, q }),
      departments: listDepartments(),
    }),
    [status, dept, q],
  )

  return (
    <>
      <div className="topbar">
        <h1>Jobs</h1>
        <div className="spacer" />
        <Link className="btn primary" to="/jobs/new">New job</Link>
      </div>

      <div className="page">
        <div className="row wrap mb">
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, job ID or skill" style={{ maxWidth: 280 }}
          />
          <Select
            options={JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABEL[s] }))}
            value={status} onChange={setStatus} placeholder="Any status" style={{ width: 150 }}
          />
          <Select
            options={departments.map((d) => ({ value: d._id, label: d.name }))}
            value={dept} onChange={setDept} placeholder="All departments" style={{ width: 200 }}
          />
        </div>

        {jobs.length === 0 ? (
          <Card>
            <Empty title="No jobs match" action={<Link className="btn primary" to="/jobs/new">New job</Link>}>
              Post a job to start adding candidates and sending AI interviews. Each job gets its own ID
              (like SLS-0001) and belongs to a department.
            </Empty>
          </Card>
        ) : (
          <div className="col">
            {jobs.map((j) => (
              <div key={j._id} className="card clickable" onClick={() => navigate(`/jobs/${j._id}`)}>
                <div className="card-body between">
                  <div style={{ minWidth: 0 }}>
                    <div className="row wrap">
                      <code className="mono dim">{j.reference}</code>
                      <strong style={{ fontSize: 15 }}>{j.title}</strong>
                      <Badge tone={STATUS_TONE[j.status]}>{JOB_STATUS_LABEL[j.status]}</Badge>
                      {j.status === 'active' && j.publish?.career_portal && <Badge tone="good">Published</Badge>}
                      {j.status === 'active' && !j.publish?.career_portal && <Badge>Not published</Badge>}
                    </div>
                    <div className="small muted" style={{ marginTop: 3 }}>
                      {j.department_name} · {j.location.city} · {j.location.mode} ·{' '}
                      {j.openings} opening{j.openings === 1 ? '' : 's'} ·{' '}
                      {j.experience.min_years}–{j.experience.max_years} yrs
                    </div>
                    <div className="row wrap" style={{ marginTop: 7, gap: 5 }}>
                      {j.skills_required.slice(0, 6).map((s) => <span key={s} className="chip">{s}</span>)}
                    </div>
                  </div>
                  <div className="small muted tabular" style={{ textAlign: 'right', flex: 'none' }}>
                    <div><strong style={{ color: 'var(--text)', fontSize: 16 }}>{j.stats.applicants}</strong> candidates</div>
                    <div>{j.stats.interviewed} interviewed</div>
                    <div>{j.stats.shortlisted} shortlisted</div>
                    <div className="dim" style={{ marginTop: 4 }}>{relative(j.created_at)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
