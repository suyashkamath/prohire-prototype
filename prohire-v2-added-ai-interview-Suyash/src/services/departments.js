// Departments (§9.2). A job cannot exist without one — the department's `code`
// is the prefix of every job reference, which is why it is immutable.

import { db } from '../lib/db.js'
import { newId, nowIso } from '../lib/ids.js'
import { stateCode } from '../domain/locations.js'
import { currentUser, logActivity } from './core.js'

export function listDepartments({ activeOnly = false, q = '' } = {}) {
  let rows = db.all('departments')
  if (activeOnly) rows = rows.filter((d) => d.active)
  if (q) {
    const needle = q.toLowerCase()
    rows = rows.filter(
      (d) => d.name.toLowerCase().includes(needle) || d.code.toLowerCase().includes(needle),
    )
  }
  return rows
    .map((d) => ({ ...d, open_positions: openPositions(d._id) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function getDepartment(id) {
  const d = db.findOne('departments', id)
  return d ? { ...d, open_positions: openPositions(id) } : null
}

/** Denormalised in the real design; recomputed here because it is cheap. */
function openPositions(departmentId) {
  return db
    .find('jobs', { department_id: departmentId })
    .filter((j) => j.status === 'active')
    .reduce((sum, j) => sum + (j.openings ?? 0), 0)
}

export function createDepartment(input) {
  const name = input.name?.trim()
  const code = input.code?.trim().toUpperCase()

  if (!name) throw new Error('Department name is required.')
  if (!code || !/^[A-Z]{2,4}$/.test(code)) {
    throw new Error('Code must be 2–4 uppercase letters — it becomes the job reference prefix.')
  }
  if (!input.location?.state || !input.location?.city) {
    throw new Error('State and city are required. Pick them from the list.')
  }
  if (db.findOne('departments', { name })) throw new Error(`"${name}" already exists.`)
  if (db.findOne('departments', { code })) throw new Error(`Code "${code}" is taken.`)

  const doc = db.insert('departments', {
    _id: newId(),
    name,
    code,
    location: {
      state: input.location.state,
      state_code: stateCode(input.location.state),
      city: input.location.city,
      area: input.location.area?.trim() || null,
    },
    zone: input.zone || null,
    headcount: Number(input.headcount) || 0,
    active: true,
    created_by: currentUser()?.username ?? 'system',
    created_at: nowIso(),
    updated_at: nowIso(),
  })

  logActivity({
    type: 'department.created',
    subject_type: 'department',
    subject_id: doc._id,
    summary: `Created department ${doc.name} (${doc.code})`,
  })
  return doc
}

export function updateDepartment(id, patch) {
  // `code` is absent from this list on purpose: changing it would orphan every
  // job reference already read out over a phone.
  const allowed = ['name', 'location', 'zone', 'headcount', 'active']
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)))
  if (clean.name) {
    const clash = db.findOne('departments', { name: clean.name.trim() })
    if (clash && clash._id !== id) throw new Error(`"${clean.name}" already exists.`)
  }
  const doc = db.update('departments', id, clean)
  logActivity({
    type: 'department.updated',
    subject_type: 'department',
    subject_id: id,
    summary: `Updated department ${doc.name}`,
  })
  return doc
}

/** Soft delete — refuses while jobs still point at it. */
export function deactivateDepartment(id) {
  const jobs = db.find('jobs', { department_id: id }).filter((j) => j.status === 'active')
  if (jobs.length) {
    throw new Error(
      `${jobs.length} active job${jobs.length === 1 ? '' : 's'} still belong${jobs.length === 1 ? 's' : ''} to this department. Close them first.`,
    )
  }
  return updateDepartment(id, { active: false })
}
