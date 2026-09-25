import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Field, Select, Empty } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { listDepartments } from '../../../services/departments.js'
import { createJob, editJob, getJob } from '../../../services/jobs.js'
import {
  STATES, citiesOf, WORK_MODES, EMPLOYMENT_TYPES, EXPERIENCE_LEVELS,
  HIRING_TYPES, languageOptions,
} from '../../../domain/locations.js'

export default function NewJob() {
  const navigate = useNavigate()
  const toast = useToast()
  return (
    <JobForm
      title="New job"
      submitLabel="Create job"
      initial={EMPTY}
      onSubmit={(input) => {
        const job = createJob(input)
        toast(`Created ${job.reference}.`, 'good')
        navigate(`/jobs/${job._id}`)
      }}
    />
  )
}

/** Everything about a job stays editable. Nothing is one-time configuration. */
export function EditJob() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const job = getJob(id)
  if (!job) {
    return <div className="page"><Card><Empty title="This job no longer exists" action={<Link className="btn" to="/jobs">Back to jobs</Link>} /></Card></div>
  }
  return (
    <JobForm
      title={`Edit ${job.reference}`}
      submitLabel="Save changes"
      editing={job}
      initial={fromJob(job)}
      onSubmit={(input) => {
        editJob(job._id, input)
        toast(`Saved ${job.reference}.`, 'good')
        navigate(`/jobs/${job._id}`)
      }}
    />
  )
}

const EMPTY = {
  title: '', department_id: '', description: '',
  skills_required: '', skills_preferred: '', primary_skill: '', primary_skill_min_years: '',
  min_years: 2, max_years: 5, level: 'Experienced',
  min_lpa: '', max_lpa: '', disclosed: false,
  employment_type: 'Full-time', state: '', city: '', mode: 'On-site',
  openings: 1, hiring_type: 'Sales', match_threshold: 65,
  interview_language_default: 'en-IN',
  publish_career_portal: true, publish_linkedin: false, draft: false,
}

function fromJob(j) {
  return {
    title: j.title, department_id: j.department_id, description: j.description,
    skills_required: j.skills_required.join(', '), skills_preferred: j.skills_preferred.join(', '),
    primary_skill: j.primary_skill ?? '', primary_skill_min_years: j.primary_skill_min_years ?? '',
    min_years: j.experience.min_years, max_years: j.experience.max_years, level: j.experience.level,
    min_lpa: j.compensation.min_lpa ?? '', max_lpa: j.compensation.max_lpa ?? '', disclosed: j.compensation.disclosed,
    employment_type: j.employment_type, state: j.location.state ?? '', city: j.location.city ?? '', mode: j.location.mode,
    openings: j.openings, hiring_type: j.screening_profile.hiring_type, match_threshold: j.screening_profile.match_threshold,
    interview_language_default: j.interview_language_default ?? 'en-IN',
  }
}

const splitList = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean)

function JobForm({ title, submitLabel, initial, editing, onSubmit }) {
  const departments = useLive(() => listDepartments({ activeOnly: true }))
  const [error, setError] = useState(null)
  const [f, setF] = useState(initial)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))

  const required = splitList(f.skills_required)

  const submit = (e) => {
    e.preventDefault()
    try {
      onSubmit({
        title: f.title,
        department_id: f.department_id,
        description: f.description,
        skills_required: required,
        skills_preferred: splitList(f.skills_preferred),
        primary_skill: f.primary_skill,
        primary_skill_min_years: f.primary_skill_min_years,
        experience: { min_years: f.min_years, max_years: f.max_years, level: f.level },
        compensation: { min_lpa: f.min_lpa, max_lpa: f.max_lpa, disclosed: f.disclosed },
        employment_type: f.employment_type,
        location: { state: f.state || undefined, city: f.city || undefined, mode: f.mode },
        openings: f.openings,
        screening_profile: { hiring_type: f.hiring_type, match_threshold: f.match_threshold },
        interview_language_default: f.interview_language_default,
        status: f.draft ? 'draft' : 'active',
        publish: { career_portal: !f.draft && f.publish_career_portal, linkedin: !f.draft && f.publish_linkedin },
      })
    } catch (err) {
      setError(err.message)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  if (departments.length === 0) {
    return (
      <>
        <div className="topbar"><h1>{title}</h1></div>
        <div className="page">
          <div className="note warn">
            There are no active departments yet. Every job belongs to a department — its code becomes
            the start of the job ID. <Link to="/departments">Create a department first.</Link>
          </div>
        </div>
      </>
    )
  }

  const dept = departments.find((d) => d._id === f.department_id)
  const back = editing ? `/jobs/${editing._id}` : '/jobs'

  return (
    <>
      <div className="topbar">
        <h1>{title}</h1>
        <div className="spacer" />
        <Link className="btn" to={back}>Cancel</Link>
        <button className="btn primary" onClick={submit}>{submitLabel}</button>
      </div>

      <form className="page" onSubmit={submit}>
        {error && <div className="note bad mb">{error}</div>}

        <div className="grid split">
          <div className="col">
            <Card title="The role">
              <div className="grid c2">
                <Field
                  label="Department"
                  hint={editing ? `Job ID stays ${editing.reference} even if you change this.` : dept ? `Job ID will be ${dept.code}-####` : 'The department code starts the job ID.'}
                >
                  <Select
                    options={departments.map((d) => ({ value: d._id, label: `${d.name} (${d.code})` }))}
                    value={f.department_id} placeholder="Select" onChange={set('department_id')}
                  />
                </Field>
                <Field label="Job title">
                  <input type="text" value={f.title} onChange={(e) => set('title')(e.target.value)} placeholder="Sales Manager — Agency Channel" />
                </Field>
              </div>

              <Field
                label="Job description"
                hint="Paste the full JD. The AI interviewer reads it to prepare questions, and the AI suggestions compare resumes against it."
              >
                <textarea
                  value={f.description} rows={12}
                  onChange={(e) => set('description')(e.target.value)}
                  placeholder={'What the person will do, and what the role needs.\n\nThe more specific this is, the better the interview questions.'}
                />
              </Field>

              <Field label="Key skills" hint="Comma separated — as many as the role needs. No limit.">
                <input type="text" value={f.skills_required} onChange={(e) => set('skills_required')(e.target.value)} placeholder="Agency Channel, Life Insurance, Lead Generation, Negotiation" />
              </Field>

              <div className="grid c2">
                <Field label="Primary skill" hint="The one the interview focuses on most.">
                  {required.length ? (
                    <Select options={required} value={f.primary_skill} onChange={set('primary_skill')} placeholder="None" />
                  ) : (
                    <input type="text" value={f.primary_skill} onChange={(e) => set('primary_skill')(e.target.value)} placeholder="Add key skills first" />
                  )}
                </Field>
                <Field label="Min. years in primary skill">
                  <input type="number" min="0" step="0.5" value={f.primary_skill_min_years} onChange={(e) => set('primary_skill_min_years')(e.target.value)} />
                </Field>
              </div>

              <Field label="Nice-to-have skills" hint="Comma separated. A bonus, never a penalty.">
                <input type="text" value={f.skills_preferred} onChange={(e) => set('skills_preferred')(e.target.value)} placeholder="Salesforce, Excel, Team Leadership" />
              </Field>
            </Card>
          </div>

          <div className="col">
            {!editing && (
              <Card title="Publish">
                <label className="check">
                  <input type="checkbox" checked={f.draft} onChange={(e) => set('draft')(e.target.checked)} />
                  <span>Save as draft <span className="hint" style={{ display: 'block' }}>Not visible anywhere until you make it active.</span></span>
                </label>
                <label className="check" style={{ opacity: f.draft ? 0.5 : 1 }}>
                  <input type="checkbox" disabled={f.draft} checked={f.publish_career_portal} onChange={(e) => set('publish_career_portal')(e.target.checked)} />
                  <span>List on the official career page <span className="hint" style={{ display: 'block' }}>Everyone who applies there arrives straight in this job.</span></span>
                </label>
                <label className="check" style={{ opacity: f.draft ? 0.5 : 1 }}>
                  <input type="checkbox" disabled={f.draft} checked={f.publish_linkedin} onChange={(e) => set('publish_linkedin')(e.target.checked)} />
                  <span>Post on LinkedIn <span className="hint" style={{ display: 'block' }}>Marked for posting — the LinkedIn connection comes with the backend.</span></span>
                </label>
              </Card>
            )}

            <Card title="Experience">
              <div className="grid c2">
                <Field label="Min years">
                  <input type="number" min="0" value={f.min_years} onChange={(e) => set('min_years')(e.target.value)} />
                </Field>
                <Field label="Max years">
                  <input type="number" min="0" value={f.max_years} onChange={(e) => set('max_years')(e.target.value)} />
                </Field>
              </div>
              <Field label="Level">
                <Select options={EXPERIENCE_LEVELS} value={f.level} onChange={set('level')} />
              </Field>
            </Card>

            <Card title="Location and terms">
              <div className="grid c2">
                <Field label="State">
                  <Select
                    options={STATES.map((s) => s.name)} value={f.state} placeholder={dept ? `${dept.location.state} (dept)` : 'Select'}
                    onChange={(v) => setF((x) => ({ ...x, state: v, city: '' }))}
                  />
                </Field>
                <Field label="City">
                  <Select options={citiesOf(f.state)} value={f.city} placeholder={dept ? `${dept.location.city} (dept)` : 'Select'} disabled={!f.state} onChange={set('city')} />
                </Field>
              </div>
              <div className="grid c2">
                <Field label="Work mode">
                  <Select options={WORK_MODES} value={f.mode} onChange={set('mode')} />
                </Field>
                <Field label="Employment type">
                  <Select options={EMPLOYMENT_TYPES} value={f.employment_type} onChange={set('employment_type')} />
                </Field>
              </div>
              <Field label="Openings">
                <input type="number" min="1" value={f.openings} onChange={(e) => set('openings')(e.target.value)} />
              </Field>
            </Card>

            <Card title="Compensation">
              <div className="grid c2">
                <Field label="Min (LPA)">
                  <input type="number" min="0" step="0.5" value={f.min_lpa} onChange={(e) => set('min_lpa')(e.target.value)} />
                </Field>
                <Field label="Max (LPA)">
                  <input type="number" min="0" step="0.5" value={f.max_lpa} onChange={(e) => set('max_lpa')(e.target.value)} />
                </Field>
              </div>
              <label className="check">
                <input type="checkbox" checked={f.disclosed} onChange={(e) => set('disclosed')(e.target.checked)} />
                Show the range on the career page
              </label>
            </Card>

            <Card title="AI suggestions and interview">
              <Field label="Hiring type" hint="Sales roles get sales interview questions; IT roles get technical ones.">
                <Select options={HIRING_TYPES} value={f.hiring_type} onChange={set('hiring_type')} />
              </Field>
              <Field
                label={`Suggest candidates above — ${f.match_threshold}% match`}
                hint="AI suggestions mark resumes above this as a good fit. It is a suggestion only; nobody is rejected automatically."
              >
                <input
                  type="range" min="40" max="95" value={f.match_threshold} style={{ width: '100%' }}
                  onChange={(e) => set('match_threshold')(Number(e.target.value))}
                />
              </Field>
              <Field label="Default interview language" hint="Just a default — you choose the language for each candidate when you invite them.">
                <Select options={languageOptions()} value={f.interview_language_default} onChange={set('interview_language_default')} />
              </Field>
            </Card>
          </div>
        </div>
      </form>
    </>
  )
}
