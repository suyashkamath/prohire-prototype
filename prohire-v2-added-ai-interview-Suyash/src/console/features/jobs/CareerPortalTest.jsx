import { useState } from 'react'

import { Modal, Field } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { applyToJob } from '../../../services/careers.js'

/**
 * Stand-in for the official career page until the integration is live.
 *
 * Sends exactly what the official site will send for one application — the
 * same fields, the same intake — so the pipeline behaviour (dedupe, consent,
 * "Career portal" source) can be seen and tested today.
 */
export default function CareerPortalTest({ job, onClose }) {
  const toast = useToast()
  const [f, setF] = useState({ full_name: '', email: '', phone: '', city: '', total_experience_years: '', resume_text: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const out = await applyToJob({ job_id: job._id, ...f, consent: true })
      toast(out.created ? `${f.full_name} applied — now in the pipeline.` : `${f.full_name} had already applied to this job.`, 'good')
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Test: an application from the career page for ${job.reference}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !f.full_name.trim()} onClick={send}>{busy ? 'Sending…' : 'Send application'}</button>
        </>
      }
    >
      <div className="note info mb">
        Once the official career page is connected, every application there arrives like this on its
        own. This form sends the same data, so you can see the result now.
      </div>
      {error && <div className="note bad mb">{error}</div>}
      <Field label="Full name"><input type="text" autoFocus value={f.full_name} onChange={set('full_name')} /></Field>
      <div className="grid c2">
        <Field label="Mobile"><input type="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
      </div>
      <div className="grid c2">
        <Field label="City"><input type="text" value={f.city} onChange={set('city')} /></Field>
        <Field label="Experience (years)"><input type="number" min="0" step="0.5" value={f.total_experience_years} onChange={set('total_experience_years')} /></Field>
      </div>
      <Field label="Resume text"><textarea rows={6} value={f.resume_text} onChange={set('resume_text')} /></Field>
    </Modal>
  )
}
