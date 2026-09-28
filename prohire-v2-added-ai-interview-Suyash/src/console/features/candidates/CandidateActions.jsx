// The dialogs behind the candidate actions menu (see useCandidateActions.jsx).

import { useState } from 'react'

import { Modal, Field, Select, CopyButton } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import {
  getCandidate, setCandidateFlag, setCandidateTags, allTags, candidateReference, primarySkillOf,
} from '../../../services/candidates.js'
import { moveStage, addNote, moveToJob, createApplication } from '../../../services/applications.js'
import { sessionsFor, reportUrl, getReportForSession } from '../../../services/interviews.js'
import { listJobs } from '../../../services/jobs.js'
import { STAGES, allowedNextStages, stageLabel } from '../../../domain/stages.js'
import { lpa, formatDate } from '../../../lib/format.js'

export function MoveStage({ ids, current, preset, onClose }) {
  const toast = useToast()
  const [stage, setStage] = useState(preset ?? '')
  const [note, setNote] = useState('')

  return (
    <Modal
      title={ids.length === 1 ? 'Change stage' : `Change stage for ${ids.length} candidates`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${stage === 'rejected' ? 'danger' : 'primary'}`} disabled={!stage}
            onClick={() => {
              ids.forEach((id) => moveStage(id, stage, note))
              toast(`Moved ${ids.length} to ${stageLabel(stage)}.`, 'good')
              onClose()
            }}
          >
            Move
          </button>
        </>
      }
    >
      <Field label="New stage">
        <Select
          options={allowedNextStages(current ?? 'sourced').map((s) => ({ value: s, label: STAGES[s].label }))}
          value={stage} onChange={setStage} placeholder="Select a stage"
        />
      </Field>
      {stage === 'selected' && (
        <div className="note info small mb">Offer, BGV and onboarding continue in Darwin.</div>
      )}
      <Field label="Note (optional)">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Saved in the history with your name." />
      </Field>
    </Modal>
  )
}

export function NoteDialog({ app, onClose }) {
  const toast = useToast()
  const [text, setText] = useState('')
  return (
    <Modal
      title={`Note on ${app.candidate_name} · ${app.job_reference}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!text.trim()} onClick={() => { addNote(app._id, text); toast('Note added.'); onClose() }}>Save note</button>
        </>
      }
    >
      {(app.notes ?? []).length > 0 && (
        <div className="col small mb" style={{ gap: 8 }}>
          {app.notes.map((n, i) => (
            <div key={i}><div>{n.text}</div><div className="dim" style={{ fontSize: 12 }}>{n.by} · {formatDate(n.at)}</div></div>
          ))}
        </div>
      )}
      <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Spoke on call — interested, 30 days notice, prefers Pune." />
    </Modal>
  )
}

export function TagsDialog({ candidate, onClose }) {
  const toast = useToast()
  const [tags, setTags] = useState(candidate.tags ?? [])
  const [text, setText] = useState('')
  const suggestions = allTags().filter((t) => !tags.includes(t))
  const add = (t) => { const v = t.trim(); if (v && !tags.includes(v)) setTags([...tags, v]); setText('') }

  return (
    <Modal
      title={`Tags · ${candidate.full_name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => { setCandidateTags(candidate._id, tags); toast('Tags saved.'); onClose() }}>Save</button>
        </>
      }
    >
      <div className="row wrap mb" style={{ gap: 6 }}>
        {tags.length ? tags.map((t) => (
          <span key={t} className="chip on">{t}<button onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>✕</button></span>
        )) : <span className="dim small">No tags yet.</span>}
      </div>
      <div className="row">
        <input
          type="text" value={text} autoFocus placeholder="e.g. Important, Future — Chennai, Call back in March"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text) } }}
        />
        <button className="btn" onClick={() => add(text)}>Add</button>
      </div>
      {suggestions.length > 0 && (
        <div className="row wrap mt" style={{ gap: 6 }}>
          <span className="small muted">Used before:</span>
          {suggestions.slice(0, 12).map((t) => <button key={t} className="chip" onClick={() => add(t)}>+ {t}</button>)}
        </div>
      )}
    </Modal>
  )
}

export function FlagDialog({ candidate, onClose }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  return (
    <Modal
      title={`Flag ${candidate.full_name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn danger" disabled={!reason.trim()} onClick={() => { setCandidateFlag(candidate._id, reason); toast('Flagged.'); onClose() }}>Flag</button>
        </>
      }
    >
      <p className="small muted">A flag shows everywhere this candidate appears, on every job — so a colleague sees it before calling them.</p>
      <Field label="Reason">
        <input type="text" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Did not turn up for 2 interviews" />
      </Field>
    </Modal>
  )
}

export function ShareDialog({ candidate, app, onClose }) {
  const session = app ? sessionsFor(app._id).find((s) => s.state === 'completed') : null
  const report = session ? getReportForSession(session._id) : null
  const lines = [
    `${candidate.full_name} (${candidateReference(candidate)})`,
    app && `For: ${app.job_reference} · ${app.job_title} — ${stageLabel(app.stage)}`,
    [candidate.current?.title, candidate.current?.company].filter(Boolean).join(' at '),
    candidate.total_experience_years != null && `Experience: ${candidate.total_experience_years} years`,
    candidate.location?.city && `Location: ${candidate.location.city}`,
    primarySkillOf(candidate) && `Primary skill: ${primarySkillOf(candidate)}`,
    (candidate.parsed?.skills ?? []).length && `Skills: ${candidate.parsed.skills.join(', ')}`,
    `Current CTC: ${lpa(candidate.current_ctc_lpa)} · Expected: ${lpa(candidate.expected_ctc_lpa)}`,
    candidate.notice_period_days != null && `Notice: ${candidate.notice_period_days === 0 ? 'Immediate' : `${candidate.notice_period_days} days`}`,
    candidate.phone && `Phone: ${candidate.phone}`,
    candidate.email && `Email: ${candidate.email}`,
    report && `AI interview: ${report.overall_score ?? '—'}/100 (${report.recommendation}) — ${reportUrl(report.share_token)}`,
  ].filter(Boolean)
  const text = lines.join('\n')

  return (
    <Modal
      title={`Share ${candidate.full_name}`}
      onClose={onClose}
      footer={
        <>
          <a className="btn" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(text)}`}>WhatsApp</a>
          <a className="btn" href={`mailto:?subject=${encodeURIComponent(`Profile: ${candidate.full_name}`)}&body=${encodeURIComponent(text)}`}>Email</a>
          <CopyButton text={text} label="Copy" className="btn primary" />
        </>
      }
    >
      <p className="small muted">For a hiring manager. The report link opens without a login.</p>
      <div className="pre">{text}</div>
    </Modal>
  )
}

export function MoveJobDialog({ candidate, app, onClose }) {
  const toast = useToast()
  const [jobId, setJobId] = useState('')
  const jobs = listJobs().filter((j) => j._id !== app.job_id && ['active', 'on_hold', 'draft'].includes(j.status))
  return (
    <Modal
      title={`Move ${candidate.full_name} to another job`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary" disabled={!jobId}
            onClick={() => {
              const { created } = moveToJob(app._id, jobId)
              toast(created ? 'Moved. They are marked withdrawn on the old job.' : 'Already on that job — marked withdrawn here.', 'good')
              onClose()
            }}
          >
            Move
          </button>
        </>
      }
    >
      <Field label="Move to" hint={`They will show as “Withdrawn” on ${app.job_reference}, so the history stays.`}>
        <Select options={jobs.map((j) => ({ value: j._id, label: `${j.reference} · ${j.title}` }))} value={jobId} onChange={setJobId} placeholder="Select a job" />
      </Field>
    </Modal>
  )
}

export function TagToJob({ candidate, onClose }) {
  const toast = useToast()
  const [jobId, setJobId] = useState('')
  const jobs = listJobs().filter((j) => ['active', 'on_hold', 'draft'].includes(j.status))
  const c = getCandidate(candidate._id)

  return (
    <Modal
      title={`Add ${c.full_name} to a job`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary" disabled={!jobId}
            onClick={() => {
              const { created } = createApplication({ candidate_id: c._id, job_id: jobId, source: { channel: 'database', by: 'console' } })
              toast(created ? 'Added to the job.' : 'Already on this job.', created ? 'good' : '')
              onClose()
            }}
          >
            Add
          </button>
        </>
      }
    >
      <Field label="Job" hint="One person can be on many jobs at once.">
        <Select options={jobs.map((j) => ({ value: j._id, label: `${j.reference} · ${j.title}` }))} value={jobId} onChange={setJobId} placeholder="Select a job" />
      </Field>
    </Modal>
  )
}
