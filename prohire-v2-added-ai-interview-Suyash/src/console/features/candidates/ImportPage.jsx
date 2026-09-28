import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Card, Field, Select, Badge } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { decodeImport, importFromPortal, previewPortalImport } from '../../../services/careers.js'
import { listJobs } from '../../../services/jobs.js'
import { parseResume } from '../../../domain/parsing.js'
import { sourceLabel } from '../../../domain/locations.js'

/**
 * Where the Chrome extension lands. The extension scrapes a LinkedIn or Naukri
 * profile and opens `/import#<data>`; this page shows what was found, lets the
 * recruiter pick a job, and saves it through the normal ingest pipeline.
 */
export default function ImportPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [payload] = useState(() => {
    try {
      return { data: decodeImport(window.location.hash) }
    } catch (err) {
      return { error: err.message }
    }
  })
  const [jobId, setJobId] = useState('')
  const [busy, setBusy] = useState(false)
  const jobs = listJobs().filter((j) => ['active', 'on_hold', 'draft'].includes(j.status))

  if (payload.error || !payload.data) {
    return (
      <>
        <div className="topbar"><h1>Import from LinkedIn / Naukri</h1></div>
        <div className="page">
          <Card>
            {payload.error
              ? <div className="note bad">{payload.error}</div>
              : <p className="muted">Nothing to import. Open a profile on LinkedIn or Naukri and click the ProHire extension.</p>}
            <p className="small muted mt">Install the extension from the <code>chrome-extension</code> folder — see its README.</p>
          </Card>
        </div>
      </>
    )
  }

  const d = payload.data
  const { text: fullText, profile } = previewPortalImport(d)
  const preview = parseResume(fullText)
  const skills = [...new Set([...(profile?.skills ?? []), ...preview.parsed.skills])]

  async function save() {
    setBusy(true)
    try {
      const res = await importFromPortal(d, { job_id: jobId || undefined })
      toast(
        `${res.candidate.full_name} ${res.outcome === 'created' ? 'saved' : 'was already in the database — updated'}${jobId ? ' and added to the job' : ''}.`,
        'good',
      )
      window.history.replaceState(null, '', '/import')
      navigate(jobId ? `/jobs/${jobId}` : `/candidates/${res.candidate._id}`)
    } catch (err) {
      toast(err.message, 'bad')
      setBusy(false)
    }
  }

  return (
    <>
      <div className="topbar">
        <h1>Import from {sourceLabel(d.source)}</h1>
        <div className="spacer" />
        <Link className="btn" to="/candidates">Cancel</Link>
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save candidate'}</button>
      </div>
      <div className="page">
        <div className="grid split">
          <Card title="What we found">
            <dl className="kv">
              <dt>Name</dt><dd><strong>{d.name ?? profile?.name ?? preview.name ?? '—'}</strong></dd>
              <dt>Current</dt><dd>{[profile?.current?.title ?? d.headline, profile?.current?.company].filter(Boolean).join(' at ') || '—'}</dd>
              {profile?.previous?.title && <><dt>Previous</dt><dd>{[profile.previous.title, profile.previous.company].filter(Boolean).join(' at ')}</dd></>}
              {profile?.education && <><dt>Education</dt><dd>{profile.education}</dd></>}
              <dt>Location</dt><dd>{profile?.location?.city ?? d.location ?? preview.location?.city ?? '—'}</dd>
              {profile?.preferred_locations?.length > 0 && <><dt>Pref. locations</dt><dd>{profile.preferred_locations.join(', ')}</dd></>}
              <dt>CTC</dt><dd>{profile?.current_ctc_lpa ?? preview.current_ctc_lpa ? `₹${profile?.current_ctc_lpa ?? preview.current_ctc_lpa} LPA` : '—'}</dd>
              <dt>Email</dt><dd>{preview.email ?? <span className="dim">not on the page</span>}</dd>
              <dt>Phone</dt><dd>{preview.phone ?? <span className="dim">not on the page</span>}</dd>
              <dt>Experience</dt><dd>{(profile?.total_experience_years ?? preview.total_experience_years) != null ? `${profile?.total_experience_years ?? preview.total_experience_years} years` : '—'}</dd>
              <dt>Profile</dt><dd className="truncate">{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.url}</a> : '—'}</dd>
            </dl>
            <h4 className="mt">Skills</h4>
            <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
              {skills.length ? skills.map((s, i) => <span key={s} className={`chip ${i === 0 && profile?.primary_skill === s ? 'on' : ''}`}>{s}</span>) : <span className="dim small">None recognised</span>}
            </div>
            {!preview.email && !preview.phone && (
              <div className="note warn small mt">
                No email or phone on this page — Naukri shows them after “View phone number”, and LinkedIn usually hides them. You can add them on the candidate&rsquo;s profile after saving.
              </div>
            )}
          </Card>
          <div className="col">
            <Card title="Save to">
              <Field label="Job (optional)" hint="Leave empty to save in the database only, for later.">
                <Select options={jobs.map((j) => ({ value: j._id, label: `${j.reference} · ${j.title}` }))} value={jobId} onChange={setJobId} placeholder="Database only" />
              </Field>
              <div className="small muted">Source: <Badge>{sourceLabel(d.source)}</Badge></div>
            </Card>
            <Card title="Page text">
              <div className="pre" style={{ maxHeight: 360, overflowY: 'auto' }}>{d.text.slice(0, 4000)}</div>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
