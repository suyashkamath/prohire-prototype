import { useState } from 'react'

import { Modal, Field, Select, Empty } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { useLive } from '../../../components/ui/useLive.js'
import { listCandidates, candidateReference, primarySkillOf } from '../../../services/candidates.js'
import { createApplication, listApplications } from '../../../services/applications.js'
import { importFromPortal } from '../../../services/careers.js'
import { sourceLabel } from '../../../domain/locations.js'
import ManualEntry from '../candidates/ManualEntry.jsx'
import UploadDialog from '../candidates/UploadDialog.jsx'

/**
 * The four ways a candidate gets onto a job, all from inside the job:
 * type their details, upload a resume, pick from the database, or pull a
 * LinkedIn / Naukri profile.
 */
export default function AddCandidates({ job, onClose }) {
  const [way, setWay] = useState(null)

  if (way === 'manual') return <ManualEntry job={job} onClose={onClose} />
  if (way === 'upload') return <UploadDialog defaultJobId={job._id} onClose={onClose} />
  if (way === 'database') return <FromDatabase job={job} onClose={onClose} />
  if (way === 'portal') return <FromPortal job={job} onClose={onClose} />

  const ways = [
    { key: 'manual', icon: '✎', title: 'Enter details', detail: 'No resume yet — just a name and a number.' },
    { key: 'upload', icon: '⇪', title: 'Upload resume', detail: 'One or many resumes from your computer.' },
    { key: 'database', icon: '☰', title: 'From database', detail: 'Someone already saved in ProHire.' },
    { key: 'portal', icon: 'in', title: 'LinkedIn / Naukri', detail: 'A profile from a job portal.' },
  ]

  return (
    <Modal title={`Add candidates to ${job.reference}`} onClose={onClose}>
      <div className="way-grid">
        {ways.map((w) => (
          <button key={w.key} className="way" onClick={() => setWay(w.key)}>
            <span className="way-icon" aria-hidden="true">{w.icon}</span>
            <strong>{w.title}</strong>
            <span className="small muted">{w.detail}</span>
          </button>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 14, marginBottom: 0 }}>
        Candidates who apply on the official career page appear here on their own.
      </p>
    </Modal>
  )
}

function FromDatabase({ job, onClose }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(() => new Set())

  const rows = useLive(() => {
    const onJob = new Set(listApplications({ job_id: job._id }).map((a) => a.candidate_id))
    return listCandidates({ q }).slice(0, 60).map((c) => ({ ...c, onJob: onJob.has(c._id) }))
  }, [q, job._id])

  const toggle = (id) => setPicked((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const add = () => {
    let added = 0
    for (const id of picked) {
      const { created } = createApplication({ candidate_id: id, job_id: job._id, source: { channel: 'database', by: 'console' } })
      if (created) added++
    }
    const skipped = picked.size - added
    toast(`${added} added to ${job.reference}${skipped ? ` · ${skipped} already on this job` : ''}.`, 'good')
    onClose()
  }

  return (
    <Modal
      wide
      title={`Add from database to ${job.reference}`}
      onClose={onClose}
      footer={
        <>
          <span className="small muted" style={{ marginRight: 'auto' }}>{picked.size} selected</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!picked.size} onClick={add}>Add {picked.size || ''} to job</button>
        </>
      }
    >
      <input
        type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Keywords — e.g. “agency channel pune” or a name, phone or candidate ID"
      />
      <div className="table-wrap" style={{ marginTop: 12, maxHeight: 420, overflowY: 'auto' }}>
        {rows.length === 0 ? (
          <Empty title="No one matches">Try fewer keywords.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th style={{ width: 30 }} /><th>Candidate</th><th>Location</th><th className="num">Exp</th><th>Primary skill</th><th>Source</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c._id} className={c.onJob ? '' : 'clickable'} onClick={() => !c.onJob && toggle(c._id)}>
                  <td><input type="checkbox" disabled={c.onJob} checked={c.onJob || picked.has(c._id)} onChange={() => toggle(c._id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td>
                    <strong>{c.full_name}</strong> <code className="mono dim small">{candidateReference(c)}</code>
                    {c.onJob && <span className="badge" style={{ marginLeft: 6 }}>already on this job</span>}
                    <div className="small dim">{c.phone ?? c.email ?? '—'}</div>
                  </td>
                  <td className="small">{c.location?.city ?? <span className="dim">—</span>}</td>
                  <td className="num tabular">{c.total_experience_years ?? '—'}</td>
                  <td>{primarySkillOf(c) ? <span className="chip">{primarySkillOf(c)}</span> : <span className="dim">—</span>}</td>
                  <td className="small muted">{sourceLabel(c.source?.channel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  )
}

/**
 * LinkedIn and Naukri. The real route is the Chrome extension — one click on
 * a profile page sends it here. Pasting the profile text is the fallback, and
 * goes through exactly the same import.
 */
export function FromPortal({ job, onClose }) {
  const toast = useToast()
  const [source, setSource] = useState('linkedin')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const res = await importFromPortal({ source, url: url || null, name: name || null, text }, { job_id: job?._id })
      toast(`${res.candidate.full_name} ${res.outcome === 'created' ? 'imported' : 'matched an existing record'}${job ? ` and added to ${job.reference}` : ''}.`, 'good')
      onClose()
    } catch (err) {
      toast(err.message, 'bad')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add from LinkedIn or Naukri"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || text.trim().length < 30} onClick={run}>{busy ? 'Importing…' : 'Import profile'}</button>
        </>
      }
    >
      <div className="note info mb">
        <strong>Fastest: the ProHire Chrome extension.</strong> Open a profile on LinkedIn or Naukri,
        click the extension{job ? ', pick this job' : ''}. See <code>chrome-extension/README.md</code> to install it.
      </div>
      <p className="small muted">Or copy the profile page text and paste it here:</p>
      <div className="grid c2">
        <Field label="Portal">
          <Select options={[{ value: 'linkedin', label: 'LinkedIn' }, { value: 'naukri', label: 'Naukri' }]} value={source} onChange={setSource} />
        </Field>
        <Field label="Name (if not in the text)"><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <Field label="Profile URL"><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/in/…" /></Field>
      <Field label="Profile text">
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Select all on the profile page (Ctrl+A), copy, and paste here." />
      </Field>
      <div className="hint">Source is recorded as {sourceLabel(source)}.</div>
    </Modal>
  )
}
