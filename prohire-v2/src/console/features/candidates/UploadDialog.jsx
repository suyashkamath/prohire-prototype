import { useRef, useState } from 'react'

import { Modal, Field, Select, Badge } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { ingestResume } from '../../../services/candidates.js'
import { createApplication, screenBatch } from '../../../services/applications.js'
import { extractResumeText, RESUME_ACCEPT } from '../../../lib/resumeFiles.js'
import { listJobs } from '../../../services/jobs.js'

/**
 * Ingest: store → extract → parse → resolve identity → optionally tag to a job.
 *
 * The tagging rule from the walkthrough: uploading from the Candidates screen
 * tags nothing (universal pool); uploading from inside a job tags that job.
 * Either is reversible, and one candidate can be tagged to many jobs.
 */
export default function UploadDialog({ defaultJobId, onClose }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const [over, setOver] = useState(false)
  const [pasted, setPasted] = useState('')
  const [jobId, setJobId] = useState(defaultJobId ?? '')
  const [autoScreen, setAutoScreen] = useState(true)
  const [busy, setBusy] = useState(null)
  const [results, setResults] = useState([])

  const jobs = listJobs({ status: 'active' })

  // `failed`: files that could not be read at all, reported alongside the rest.
  async function ingest(items, failed = []) {
    setBusy(`Reading ${items.length} resume${items.length === 1 ? '' : 's'}…`)
    const out = []
    const appIds = []

    for (const [i, item] of items.entries()) {
      setBusy(`Parsing ${i + 1} of ${items.length}…`)
      try {
        const res = await ingestResume({ filename: item.filename, text: item.text })
        if (jobId) {
          const { application } = createApplication({
            candidate_id: res.candidate._id,
            job_id: jobId,
            source: { channel: 'resume_upload', by: 'upload' },
          })
          appIds.push(application._id)
        }
        out.push({ ...res, filename: item.filename, warning: item.warning })
      } catch (err) {
        out.push({ outcome: 'error', filename: item.filename, error: err.message })
      }
    }

    if (jobId && autoScreen && appIds.length) {
      await screenBatch(appIds, {
        concurrency: 5,
        onProgress: (d, t) => setBusy(`Screening ${d} of ${t}…`),
      })
    }

    setResults([...out, ...failed])
    setBusy(null)
    const created = out.filter((r) => r.outcome === 'created').length
    const errors = out.filter((r) => r.outcome === 'error').length + failed.length
    toast(
      `${created} added, ${out.length - created - (errors - failed.length)} matched an existing record${errors ? `, ${errors} could not be read` : ''}.`,
      errors ? 'warn' : 'good',
    )
  }

  async function onFiles(fileList) {
    const files = [...fileList]
    if (!files.length) return
    const items = []
    const failed = []
    for (const [i, file] of files.entries()) {
      setBusy(`Reading file ${i + 1} of ${files.length}…`)
      try {
        const { text, warning } = await extractResumeText(file)
        items.push({ filename: file.name, text, warning })
      } catch (err) {
        failed.push({ outcome: 'error', filename: file.name, error: err.message })
      }
    }
    if (fileRef.current) fileRef.current.value = ''     // the same file can be picked again
    if (!items.length) {
      setBusy(null)
      setResults(failed)
      return
    }
    await ingest(items, failed)
  }

  if (results.length) {
    return (
      <Modal
        title="Ingest complete"
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={() => { setResults([]); setPasted('') }}>Add more</button>
            <button className="btn primary" onClick={onClose}>Done</button>
          </>
        }
      >
        <table className="table">
          <thead><tr><th>File</th><th>Name</th><th>Outcome</th></tr></thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td className="small truncate" style={{ maxWidth: 180 }}>{r.filename}</td>
                <td>{r.candidate?.full_name ?? <span className="dim">—</span>}</td>
                <td>
                  <OutcomeBadge result={r} />
                  {r.warning && <div className="small muted" style={{ marginTop: 4 }}>{r.warning}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    )
  }

  return (
    <Modal
      title="Add candidates"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={Boolean(busy) || !pasted.trim()}
            onClick={() => ingest([{ filename: 'pasted-resume.txt', text: pasted }])}
          >
            {busy ?? 'Add pasted resume'}
          </button>
        </>
      }
    >
      <div
        className={`drop ${over ? 'over' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files) }}
      >
        <strong>{busy ?? 'Drop resumes here'}</strong>
        <div className="small" style={{ marginTop: 4 }}>
          {busy ? 'This takes a moment for a PDF.' : 'or click to choose files — PDF, Word (.docx, .doc) or text, one or many'}
        </div>
        <input
          ref={fileRef} type="file" multiple hidden accept={RESUME_ACCEPT}
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        Read in this browser; the files are not uploaded anywhere. A scanned PDF (a photo of the page) has
        no text to read — paste its text below instead.
      </p>

      <Field label="Or paste resume text" style={{ marginTop: 14 }}>
        <textarea
          rows={9} value={pasted} onChange={(e) => setPasted(e.target.value)}
          placeholder={'Priya Sharma\npriya@example.com | 9876543210\nTotal experience: 5 years\nExpected CTC: 18 LPA | Notice period: 30 days\n\nSKILLS\nC#, ASP.NET Core, SQL Server…'}
        />
      </Field>

      <div className="divider" />

      <Field
        label="Tag to a job"
        hint="Leave empty and they go to the universal pool only. Tagging is reversible, and one person can be tagged to many jobs."
      >
        <Select
          options={jobs.map((j) => ({ value: j._id, label: `${j.reference} · ${j.title}` }))}
          value={jobId} onChange={setJobId} placeholder="Universal pool (no job)"
        />
      </Field>

      {jobId && (
        <label className="check">
          <input type="checkbox" checked={autoScreen} onChange={(e) => setAutoScreen(e.target.checked)} />
          Screen against the job description straight away
        </label>
      )}
    </Modal>
  )
}

function OutcomeBadge({ result }) {
  // A reason to act on, not a status: it wraps, where a badge would not.
  if (result.outcome === 'error') return <span className="field-err" style={{ fontSize: 13 }}>{result.error}</span>
  const map = {
    created:   ['good', 'New candidate'],
    merged:    ['info', `Matched on ${result.identity?.signal} — resume version added`],
    duplicate: ['', 'Identical resume — ignored'],
    flagged:   ['warn', 'Similar name — flagged, not merged'],
    error:     ['bad', result.error],
  }
  const [tone, label] = map[result.outcome] ?? ['', result.outcome]
  return <Badge tone={tone}>{label}</Badge>
}
