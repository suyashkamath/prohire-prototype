import { useState } from 'react'

import { Modal, Field, Select } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { createCandidate, resolveIdentity } from '../../../services/candidates.js'
import { createApplication } from '../../../services/applications.js'
import { normalizeEmail, normalizePhone } from '../../../domain/parsing.js'
import { STATES, citiesOf } from '../../../domain/locations.js'
import { currentUser } from '../../../services/core.js'

/**
 * "My friend is looking — I don't have her resume." A name and a number are
 * enough to start; everything else can be filled in later.
 */
export default function ManualEntry({ job, onClose }) {
  const toast = useToast()
  const [f, setF] = useState({
    full_name: '', email: '', phone: '', title: '', company: '', years: '', notice: '',
    current: '', expected: '', skills: '', primary: '', state: '', city: '', channel: 'manual_entry', referred_by: '',
  })
  const [error, setError] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target?.value ?? e }))

  const skills = f.skills.split(',').map((s) => s.trim()).filter(Boolean)

  const save = () => {
    setError(null)
    const email = normalizeEmail(f.email)
    const phone = normalizePhone(f.phone)
    if (!email && !phone) return setError('Add an email or a phone number, so you can reach them.')

    // Same person already in the database? Use that record rather than
    // creating a second one.
    const identity = resolveIdentity({ email, phone })
    const by = currentUser()?.username ?? 'system'
    const candidate = identity.action === 'merge'
      ? identity.candidate
      : createCandidate({
          full_name: f.full_name,
          email: f.email,
          phone: f.phone,
          location: { state: f.state || null, city: f.city || null },
          current: { title: f.title || null, company: f.company || null },
          total_experience_years: f.years,
          notice_period_days: f.notice,
          current_ctc_lpa: f.current,
          expected_ctc_lpa: f.expected,
          primary_skill: f.primary || skills[0] || null,
          parsed: { skills, languages: [], links: {}, confidence: 1 },
        }, {
          channel: f.channel,
          detail: f.channel === 'referral' ? f.referred_by || null : null,
          by,
        })

    if (job) createApplication({ candidate_id: candidate._id, job_id: job._id, source: { channel: f.channel, by } })
    toast(
      identity.action === 'merge'
        ? `${candidate.full_name} was already in the database (matched on ${identity.signal})${job ? ` — added to ${job.reference}` : ''}.`
        : `${candidate.full_name} added${job ? ` to ${job.reference}` : ' to the database'}.`,
      'good',
    )
    onClose()
  }

  return (
    <Modal
      title={job ? `Add a candidate to ${job.reference}` : 'Add a candidate'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!f.full_name.trim()} onClick={save}>Add candidate</button>
        </>
      }
    >
      {error && <div className="note bad mb">{error}</div>}
      <Field label="Full name"><input type="text" value={f.full_name} autoFocus onChange={set('full_name')} /></Field>
      <div className="grid c2">
        <Field label="Phone"><input type="tel" value={f.phone} onChange={set('phone')} placeholder="9876543210" /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
      </div>
      <div className="grid c2">
        <Field label="State">
          <Select options={STATES.map((s) => s.name)} value={f.state} placeholder="Select" onChange={(v) => setF((x) => ({ ...x, state: v, city: '' }))} />
        </Field>
        <Field label="City">
          <Select options={citiesOf(f.state)} value={f.city} placeholder="Select" disabled={!f.state} onChange={set('city')} />
        </Field>
      </div>
      <div className="grid c2">
        <Field label="Current title"><input type="text" value={f.title} onChange={set('title')} /></Field>
        <Field label="Current company"><input type="text" value={f.company} onChange={set('company')} /></Field>
      </div>
      <div className="grid c4">
        <Field label="Experience (yrs)"><input type="number" step="0.5" value={f.years} onChange={set('years')} /></Field>
        <Field label="Notice (days)"><input type="number" value={f.notice} onChange={set('notice')} /></Field>
        <Field label="Current (LPA)"><input type="number" step="0.5" value={f.current} onChange={set('current')} /></Field>
        <Field label="Expected (LPA)"><input type="number" step="0.5" value={f.expected} onChange={set('expected')} /></Field>
      </div>
      <Field label="Key skills" hint="Comma separated.">
        <input type="text" value={f.skills} onChange={set('skills')} placeholder="Agency Channel, Life Insurance, Negotiation" />
      </Field>
      <div className="grid c2">
        <Field label="Primary skill">
          <Select options={skills} value={f.primary} placeholder={skills[0] ? `${skills[0]} (first)` : 'Add skills first'} disabled={!skills.length} onChange={set('primary')} />
        </Field>
        <Field label="Source">
          <Select
            options={[
              { value: 'manual_entry', label: 'Added manually' },
              { value: 'referral', label: 'Referral' },
              { value: 'linkedin', label: 'LinkedIn' },
              { value: 'naukri', label: 'Naukri' },
            ]}
            value={f.channel} onChange={set('channel')}
          />
        </Field>
      </div>
      {f.channel === 'referral' && (
        <Field label="Referred by"><input type="text" value={f.referred_by} onChange={set('referred_by')} placeholder="Employee name" /></Field>
      )}
    </Modal>
  )
}
