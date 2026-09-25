import { useRef, useState } from 'react'

import { Modal, Field, Select, Badge } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { ingestResume } from '../../../services/candidates.js'
import { createApplication, screenBatch } from '../../../services/applications.js'
import { isReadableAsText, readFileAsText } from '../../../domain/parsing.js'
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

  async function ingest(items) {
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
        out.push({ ...res, filename: item.filename })
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

    setResults(out)
    setBusy(null)
    const created = out.filter((r) => r.outcome === 'created').length
    toast(`${created} added, ${out.length - created} matched an existing record.`, 'good')
  }

  async function onFiles(fileList) {
    const files = [...fileList]
    const readable = files.filter(isReadableAsText)
    const unreadable = files.filter((f) => !isReadableAsText(f))

    if (unreadable.length) {
      toast(
        `${unreadable.length} file${unreadable.length === 1 ? '' : 's'} skipped — PDF and DOCX need server-side extraction. Paste the text instead.`,
        'bad',
      )
    }
    if (!readable.length) return

    const items = await Promise.all(
      readable.map(async (f) => ({ filename: f.name, text: await readFileAsText(f) })),
    )
    await ingest(items)
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
                <td><OutcomeBadge result={r} /></td>
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
        <strong>Drop resumes here</strong>
        <div className="small" style={{ marginTop: 4 }}>or click to choose files</div>
        <input
          ref={fileRef} type="file" multiple hidden accept=".txt,.md,.csv,text/*"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      <div className="note warn" style={{ marginTop: 12 }}>
        <strong>Prototype limit:</strong> a browser cannot extract text from PDF or DOCX — that needs
        poppler and python-docx on a server. Plain text works; for anything else, paste the text
        below. Everything after extraction — parsing, dedupe, screening — is the real pipeline.
      </div>

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
