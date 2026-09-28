import { useState } from 'react'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Field, Select, Modal, Empty, Badge } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { listDepartments, createDepartment, deactivateDepartment } from '../../../services/departments.js'
import { STATES, ZONES, citiesOf } from '../../../domain/locations.js'

export default function DepartmentsPage() {
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const rows = useLive(() => listDepartments())

  return (
    <>
      <div className="topbar">
        <h1>Departments</h1>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setOpen(true)}>New department</button>
      </div>

      <div className="page">
        <div className="note info mb">
          A job cannot exist without a department. The department&rsquo;s <strong>code</strong> becomes
          the prefix of every job reference — <code>IT</code> gives you <code>IT-0022</code>, which is
          what a recruiter reads out on a phone call. It cannot be changed afterwards.
        </div>

        <Card>
          {rows.length === 0 ? (
            <Empty title="No departments yet" action={<button className="btn primary" onClick={() => setOpen(true)}>New department</button>}>
              Create one to start. Everything else in ProHire hangs off it.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th><th>Department</th><th>Location</th><th>Zone</th>
                    <th className="num">Headcount</th><th className="num">Open positions</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d._id}>
                      <td><code className="mono">{d.code}</code></td>
                      <td>
                        <strong>{d.name}</strong>
                        {!d.active && <Badge tone="bad" style={{ marginLeft: 8 }}>Inactive</Badge>}
                      </td>
                      <td className="muted">
                        {[d.location.area, d.location.city, d.location.state].filter(Boolean).join(', ')}
                      </td>
                      <td className="muted">{d.zone ?? <span className="dim">—</span>}</td>
                      <td className="num tabular">{d.headcount}</td>
                      <td className="num tabular">{d.open_positions}</td>
                      <td className="num">
                        {d.active && (
                          <button
                            className="btn ghost sm"
                            onClick={() => {
                              try {
                                deactivateDepartment(d._id)
                                toast(`${d.name} deactivated.`)
                              } catch (err) {
                                toast(err.message, 'bad')
                              }
                            }}
                          >
                            Deactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {open && <NewDepartment onClose={() => setOpen(false)} />}
    </>
  )
}

function NewDepartment({ onClose }) {
  const toast = useToast()
  const [form, setForm] = useState({
    name: '', code: '', state: '', city: '', area: '', zone: '', headcount: '',
  })
  const [error, setError] = useState(null)
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = () => {
    try {
      const d = createDepartment({
        name: form.name,
        code: form.code,
        location: { state: form.state, city: form.city, area: form.area },
        zone: form.zone || null,
        headcount: form.headcount,
      })
      toast(`Created ${d.name} (${d.code}).`, 'good')
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Modal
      title="New department"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit}>Create department</button>
        </>
      }
    >
      {error && <div className="note bad mb">{error}</div>}

      <Field label="Department name">
        <input type="text" value={form.name} autoFocus onChange={(e) => set('name')(e.target.value)} placeholder="Information Technology" />
      </Field>

      <Field
        label="Code"
        hint="2–4 uppercase letters. Becomes the job reference prefix and cannot be changed later."
      >
        <input
          type="text" value={form.code} maxLength={4} style={{ textTransform: 'uppercase', fontFamily: 'var(--mono)' }}
          onChange={(e) => set('code')(e.target.value.toUpperCase())} placeholder="IT"
        />
      </Field>

      <div className="grid c2">
        <Field label="State">
          <Select
            options={STATES.map((s) => s.name)} value={form.state} placeholder="Select a state"
            onChange={(v) => setForm((f) => ({ ...f, state: v, city: '' }))}
          />
        </Field>
        <Field label="City">
          <Select
            options={citiesOf(form.state)} value={form.city} placeholder={form.state ? 'Select a city' : 'Pick a state first'}
            disabled={!form.state} onChange={set('city')}
          />
        </Field>
      </div>

      <Field label="Area" hint="Optional and free text — this is the part nobody spells the same way twice.">
        <input type="text" value={form.area} onChange={(e) => set('area')(e.target.value)} placeholder="Borivali" />
      </Field>

      <div className="grid c2">
        <Field label="Zone" hint="Optional.">
          <Select options={ZONES} value={form.zone} placeholder="None" onChange={set('zone')} />
        </Field>
        <Field label="Headcount">
          <input type="number" min="0" value={form.headcount} onChange={(e) => set('headcount')(e.target.value)} placeholder="42" />
        </Field>
      </div>
    </Modal>
  )
}
