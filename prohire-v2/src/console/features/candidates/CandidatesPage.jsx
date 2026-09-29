import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Empty, Select, Menu, Modal } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import {
  listCandidates, allSkills, allTags, mergeCandidates, dismissReviewFlag, getCandidate,
  candidateReference, primarySkillOf,
} from '../../../services/candidates.js'
import { listApplications } from '../../../services/applications.js'
import { sourceLabel, SOURCE_CHANNELS } from '../../../domain/locations.js'
import { stageLabel } from '../../../domain/stages.js'
import { initials, relative } from '../../../lib/format.js'
import { downloadCsv } from '../../../lib/csv.js'
import UploadDialog from './UploadDialog.jsx'
import ManualEntry from './ManualEntry.jsx'
import { FromPortal } from '../jobs/AddCandidates.jsx'
import { useCandidateActions } from './useCandidateActions.jsx'
import CandidateCard from './CandidateCard.jsx'

/**
 * The candidate database (ATS). Everyone ever added, whether or not they are
 * on a job — the "locker" to come back to when a new position opens.
 */
export default function CandidatesPage() {
  const navigate = useNavigate()
  const actions = useCandidateActions()
  const [f, setF] = useState({ q: '', skill: '', city: '', source: '', tag: '', minExp: '', maxExp: '', flagged: false })
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }))
  const [adding, setAdding] = useState(null)
  const [view, setViewState] = useState(() => { try { return localStorage.getItem('prohire.v2.candView') ?? 'cards' } catch { return 'cards' } })
  const setView = (v) => { setViewState(v); try { localStorage.setItem('prohire.v2.candView', v) } catch { /* private mode */ } }

  const data = useLive(
    () => {
      const rows = listCandidates({ ...f, skill: f.skill || undefined, tag: f.tag || undefined, city: f.city || undefined, source: f.source || undefined })
      const apps = listApplications()
      const everyone = listCandidates()
      return {
        rows: rows.map((c) => ({ ...c, applications: apps.filter((a) => a.candidate_id === c._id) })),
        total: everyone.length,
        skills: allSkills().slice(0, 40),
        tags: allTags(),
        cities: [...new Set(everyone.map((c) => c.location?.city).filter(Boolean))].sort(),
        flagged: everyone.filter((c) => c.review_flag),
      }
    },
    [f],
  )

  const filtered = f.q || f.skill || f.city || f.source || f.tag || f.minExp || f.maxExp || f.flagged

  function exportRows() {
    downloadCsv(`candidates-${new Date().toISOString().slice(0, 10)}.csv`, [
      { label: 'Candidate ID', value: (c) => candidateReference(c) },
      { label: 'Name', value: (c) => c.full_name },
      { label: 'Phone', value: (c) => c.phone },
      { label: 'Email', value: (c) => c.email },
      { label: 'City', value: (c) => c.location?.city },
      { label: 'Current title', value: (c) => c.current?.title },
      { label: 'Current company', value: (c) => c.current?.company },
      { label: 'Experience (yrs)', value: (c) => c.total_experience_years },
      { label: 'Primary skill', value: (c) => primarySkillOf(c) },
      { label: 'Key skills', value: (c) => c.parsed?.skills ?? [] },
      { label: 'Current CTC (LPA)', value: (c) => c.current_ctc_lpa },
      { label: 'Expected CTC (LPA)', value: (c) => c.expected_ctc_lpa },
      { label: 'Notice (days)', value: (c) => c.notice_period_days },
      { label: 'Tags', value: (c) => c.tags ?? [] },
      { label: 'Flag', value: (c) => c.flag?.reason },
      { label: 'Source', value: (c) => sourceLabel(c.source?.channel) },
      { label: 'Added by', value: (c) => c.created_by },
      { label: 'Added on', value: (c) => c.created_at?.slice(0, 10) },
      { label: 'Jobs', value: (c) => c.applications.map((a) => `${a.job_reference} (${stageLabel(a.stage)})`) },
      { label: 'Data consent', value: (c) => c.consent?.data_processing },
    ], data.rows)
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Candidates</h1>
          <div className="small muted">Your resume bank — {data.total} people</div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={exportRows}>Export to Excel</button>
        <button className="btn primary" onClick={() => setAdding('choose')}>+ Add candidate</button>
      </div>

      <div className="page wide">
        {data.flagged.length > 0 && (
          <div className="note warn mb">
            <strong>{data.flagged.length} possible duplicate{data.flagged.length === 1 ? '' : 's'}</strong> — similar
            names, but not enough to merge automatically. Check and decide:
            <div className="col" style={{ gap: 6, marginTop: 8 }}>
              {data.flagged.map((c) => <MergeReview key={c._id} candidate={c} />)}
            </div>
          </div>
        )}

        <div className="filters mb">
          <input
            type="search" value={f.q} onChange={set('q')}
            placeholder="Keywords — e.g. “agency channel pune”, a name, phone or CAN-00012"
            style={{ flex: '1 1 320px' }}
          />
          <Select options={data.skills.map((s) => ({ value: s.skill, label: `${s.skill} (${s.count})` }))} value={f.skill} onChange={set('skill')} placeholder="Any skill" style={{ width: 170 }} />
          <Select options={data.cities} value={f.city} onChange={set('city')} placeholder="Any city" style={{ width: 140 }} />
          <Select options={Object.entries(SOURCE_CHANNELS).filter(([k]) => k !== 'manual').map(([k, v]) => ({ value: k, label: v }))} value={f.source} onChange={set('source')} placeholder="Any source" style={{ width: 150 }} />
          {data.tags.length > 0 && <Select options={data.tags} value={f.tag} onChange={set('tag')} placeholder="Any tag" style={{ width: 130 }} />}
          <div className="row" style={{ gap: 4 }}>
            <input type="number" min="0" value={f.minExp} onChange={set('minExp')} placeholder="Min yrs" style={{ width: 82 }} aria-label="Minimum experience" />
            <span className="dim">–</span>
            <input type="number" min="0" value={f.maxExp} onChange={set('maxExp')} placeholder="Max yrs" style={{ width: 82 }} aria-label="Maximum experience" />
          </div>
          <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={f.flagged} onChange={set('flagged')} /> Flagged</label>
          {filtered && <button className="btn ghost sm" onClick={() => setF({ q: '', skill: '', city: '', source: '', tag: '', minExp: '', maxExp: '', flagged: false })}>Clear</button>}
          <span className="small muted">{data.rows.length} shown</span>
          <div className="seg" role="group" aria-label="View">
            <button className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')}>Cards</button>
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button>
          </div>
        </div>

        {data.rows.length === 0 ? (
          <Card>
            {data.total === 0 ? (
              <Empty title="No candidates yet" action={<button className="btn primary" onClick={() => setAdding('choose')}>+ Add candidate</button>}>
                Save every good profile here — even when there is no opening today. When a position
                comes up, search here first.
              </Empty>
            ) : (
              <Empty title="No one matches">Try fewer keywords or clear a filter.</Empty>
            )}
          </Card>
        ) : view === 'cards' ? (
          <div className="col">
            {data.rows.map((c) => (
              <CandidateCard
                key={c._id} c={c} highlight={f.q}
                onOpen={() => navigate(`/candidates/${c._id}`)}
                onAddToJob={() => actions.open('tagjob', c, null)}
                menu={actions.itemsFor(c, null)}
              />
            ))}
          </div>
        ) : (
          <Card>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Candidate</th><th>Location</th><th className="num">Exp</th><th>Skills</th>
                    <th>Current</th><th>Source</th><th>Jobs</th><th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((c) => {
                    const primary = primarySkillOf(c)
                    const skills = c.parsed?.skills ?? []
                    return (
                      <tr key={c._id} className={`clickable ${c.flag ? 'flagged' : ''}`} onClick={() => navigate(`/candidates/${c._id}`)}>
                        <td>
                          <div className="row">
                            <span className="avatar">{initials(c.full_name)}</span>
                            <div style={{ minWidth: 0 }}>
                              <div className="row" style={{ gap: 6 }}>
                                <strong>{c.full_name}</strong>
                                <code className="mono dim small">{candidateReference(c)}</code>
                                {c.flag && <span className="badge bad" title={c.flag.reason}>⚑</span>}
                              </div>
                              <div className="small dim truncate">{[c.phone, c.email].filter(Boolean).join(' · ') || 'no contact details'}</div>
                              {(c.tags ?? []).length > 0 && (
                                <div className="row wrap" style={{ gap: 3, marginTop: 3 }}>{c.tags.slice(0, 3).map((t) => <span key={t} className="badge">{t}</span>)}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="small">{c.location?.city ?? <span className="dim">—</span>}</td>
                        <td className="num tabular">{c.total_experience_years ?? <span className="dim">—</span>}</td>
                        <td>
                          <div className="row wrap" style={{ gap: 4, maxWidth: 240 }}>
                            {primary && <span className="chip on" title="Primary skill">★ {primary}</span>}
                            {skills.filter((s) => s !== primary).slice(0, 3).map((s) => <span key={s} className="chip">{s}</span>)}
                            {skills.length > 4 && <span className="dim small">+{skills.length - 4}</span>}
                          </div>
                        </td>
                        <td className="small muted">
                          {c.current?.title ?? <span className="dim">—</span>}
                          {c.current?.company && <div className="dim">{c.current.company}</div>}
                        </td>
                        <td className="small">
                          <div>{sourceLabel(c.source?.channel)}</div>
                          <div className="dim">by {c.created_by} · {relative(c.created_at)}</div>
                        </td>
                        <td>
                          {c.applications.length === 0
                            ? <span className="dim small">database only</span>
                            : <div className="col" style={{ gap: 2 }}>
                                {c.applications.slice(0, 2).map((a) => (
                                  <span key={a._id} className="small"><code className="mono dim">{a.job_reference}</code> {stageLabel(a.stage)}</span>
                                ))}
                                {c.applications.length > 2 && <span className="dim small">+{c.applications.length - 2} more</span>}
                              </div>}
                        </td>
                        <td className="num" onClick={(e) => e.stopPropagation()}>
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                            <button className="btn sm" onClick={() => actions.open('tagjob', c, null)}>Add to job</button>
                            <Menu items={actions.itemsFor(c, null)} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {adding === 'choose' && <AddCandidateChoice onPick={setAdding} onClose={() => setAdding(null)} />}
      {adding === 'upload' && <UploadDialog onClose={() => setAdding(null)} />}
      {adding === 'manual' && <ManualEntry onClose={() => setAdding(null)} />}
      {adding === 'portal' && <FromPortal job={null} onClose={() => setAdding(null)} />}
      {actions.element}
    </>
  )
}

function MergeReview({ candidate }) {
  const toast = useToast()
  const other = getCandidate(candidate.review_flag.other_id)
  if (!other) return null
  return (
    <div className="row wrap small">
      <strong>{candidate.full_name}</strong>
      <span className="dim">looks like</span>
      <strong>{other.full_name}</strong>
      <span className="dim">({other.email ?? other.phone})</span>
      <button className="btn sm" onClick={() => { mergeCandidates(candidate._id, other._id); toast('Merged.', 'good') }}>
        Same person — merge
      </button>
      <button className="btn ghost sm" onClick={() => { dismissReviewFlag(candidate._id); toast('Kept separate.') }}>
        Different people
      </button>
    </div>
  )
}

// The three ways a candidate gets into ProHire, behind one button.
const ADD_WAYS = [
  { key: 'upload', icon: '⇪', title: 'Upload resumes', detail: 'PDF, Word or text files — one or many — or paste a resume. Details are read from each one.' },
  { key: 'manual', icon: '✎', title: 'Enter details', detail: 'Type in one candidate by hand. A name and a phone number are enough.' },
  { key: 'portal', icon: '⇄', title: 'From LinkedIn / Naukri', detail: 'Import a profile with the ProHire Chrome extension, or paste the profile text.' },
]

function AddCandidateChoice({ onPick, onClose }) {
  return (
    <Modal title="Add candidate" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>How would you like to add them?</p>
      <ul className="add-ways">
        {ADD_WAYS.map((w) => (
          <li key={w.key}>
            <button className="add-way" onClick={() => onPick(w.key)}>
              <span className="add-way-icon" aria-hidden="true">{w.icon}</span>
              <span className="add-way-text">
                <strong>{w.title}</strong>
                <span className="small muted">{w.detail}</span>
              </span>
              <span className="add-way-go" aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
