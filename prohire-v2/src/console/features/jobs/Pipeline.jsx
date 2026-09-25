import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Card, Badge, Match, Select, Empty, Menu } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { listApplications, screenBatch } from '../../../services/applications.js'
import { sessionsFor } from '../../../services/interviews.js'
import { getCandidate, candidateReference, primarySkillOf } from '../../../services/candidates.js'
import { stageLabel, stageTone, FUNNEL, STAGES } from '../../../domain/stages.js'
import { sourceLabel } from '../../../domain/locations.js'
import { relative } from '../../../lib/format.js'
import { downloadCsv } from '../../../lib/csv.js'
import { MoveStage } from '../candidates/CandidateActions.jsx'
import { useCandidateActions } from '../candidates/useCandidateActions.jsx'
import InviteDialog from './InviteDialog.jsx'

/**
 * The workhorse screen. Everything a recruiter does in a day should be
 * reachable from here: one row per candidate, one primary button, and every
 * other action under "⋯".
 */
export default function Pipeline({ job, applications, onAdd }) {
  const navigate = useNavigate()
  const toast = useToast()
  const actions = useCandidateActions()
  const [sort, setSort] = useState('updated')
  const [stage, setStage] = useState('')
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [screening, setScreening] = useState(null)
  const [inviting, setInviting] = useState(null)
  const [movingStage, setMovingStage] = useState(null)

  const rows = listApplications({ job_id: job._id, stage: stage || undefined, sort })
    .map((a) => ({ ...a, candidate: getCandidate(a.candidate_id) }))
    .filter((a) => a.candidate)
    .filter((a) => !source || a.source?.channel === source)
    .filter((a) => {
      if (!q) return true
      const hay = [a.candidate_name, a.candidate.phone, a.candidate.email, candidateReference(a.candidate), a.candidate.location?.city, ...(a.candidate.parsed?.skills ?? [])].join(' ').toLowerCase()
      return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))
    })
  const unscreened = applications.filter((a) => !a.screening)
  const counts = Object.fromEntries(
    FUNNEL.map((f) => [f.key, applications.filter((a) => a.stage === f.key).length]),
  )
  const sources = [...new Set(applications.map((a) => a.source?.channel).filter(Boolean))]

  async function suggest(ids) {
    setScreening({ done: 0, total: ids.length })
    try {
      const results = await screenBatch(ids, {
        concurrency: 5,
        onProgress: (done, total) => setScreening({ done, total }),
      })
      const good = results.filter((r) => r.decision === 'Shortlisted').length
      toast(`${results.length} checked · ${good} suggested as a good fit.`, 'good')
      setSelected(new Set())
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setScreening(null)
    }
  }

  function exportRows() {
    downloadCsv(`${job.reference}-candidates.csv`, [
      { label: 'Candidate ID', value: (a) => candidateReference(a.candidate) },
      { label: 'Name', value: (a) => a.candidate_name },
      { label: 'Phone', value: (a) => a.candidate.phone },
      { label: 'Email', value: (a) => a.candidate.email },
      { label: 'City', value: (a) => a.candidate.location?.city },
      { label: 'Experience (yrs)', value: (a) => a.candidate.total_experience_years },
      { label: 'Primary skill', value: (a) => primarySkillOf(a.candidate) },
      { label: 'Key skills', value: (a) => a.candidate.parsed?.skills ?? [] },
      { label: 'Current CTC (LPA)', value: (a) => a.candidate.current_ctc_lpa },
      { label: 'Expected CTC (LPA)', value: (a) => a.candidate.expected_ctc_lpa },
      { label: 'Notice (days)', value: (a) => a.candidate.notice_period_days },
      { label: 'Stage', value: (a) => stageLabel(a.stage) },
      { label: 'AI match %', value: (a) => a.screening?.match_percent },
      { label: 'Interview score', value: (a) => a.interview_summary?.overall_score },
      { label: 'Interview recommendation', value: (a) => a.interview_summary?.recommendation },
      { label: 'Source', value: (a) => sourceLabel(a.source?.channel) },
      { label: 'Added by', value: (a) => a.stage_history?.[0]?.by },
      { label: 'Added on', value: (a) => a.created_at?.slice(0, 10) },
    ], rows)
  }

  const toggle = (id) => setSelected((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  if (applications.length === 0) {
    return (
      <Card>
        <Empty
          title="No candidates on this job yet"
          action={<button className="btn primary" onClick={onAdd}>Add candidates</button>}
        >
          Enter someone&rsquo;s details, upload resumes, pick people from the database, or pull
          profiles from LinkedIn and Naukri.{job.publish?.career_portal && ' Career-page applications will appear here automatically.'}
        </Empty>
      </Card>
    )
  }

  return (
    <>
      <div className="funnel mb">
        {FUNNEL.map((f) => (
          <button
            key={f.key}
            className={`funnel-step ${stage === f.key ? 'on' : ''}`}
            onClick={() => setStage(stage === f.key ? '' : f.key)}
          >
            <span className="small muted">{f.label}</span>
            <strong className="tabular">{counts[f.key] ?? 0}</strong>
          </button>
        ))}
      </div>

      <div className="row wrap mb">
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone, ID, city, skill" style={{ maxWidth: 260 }}
        />
        <Select
          options={Object.entries(STAGES).map(([k, v]) => ({ value: k, label: v.label }))}
          value={stage} onChange={setStage} placeholder="Any stage" style={{ width: 150 }}
        />
        {sources.length > 1 && (
          <Select
            options={sources.map((s) => ({ value: s, label: sourceLabel(s) }))}
            value={source} onChange={setSource} placeholder="Any source" style={{ width: 150 }}
          />
        )}
        <Select
          value={sort} onChange={setSort} style={{ width: 180 }}
          options={[
            { value: 'updated', label: 'Sort: recently updated' },
            { value: 'score', label: 'Sort: AI match %' },
            { value: 'interview', label: 'Sort: interview score' },
            { value: 'name', label: 'Sort: name' },
          ]}
        />
        <div className="spacer" style={{ flex: 1 }} />
        {selected.size > 0 && (
          <>
            <span className="small muted">{selected.size} selected</span>
            <button className="btn" onClick={() => setMovingStage([...selected])}>Change stage</button>
            <button className="btn" disabled={Boolean(screening)} onClick={() => suggest([...selected])}>AI suggestion</button>
          </>
        )}
        {selected.size === 0 && unscreened.length > 0 && (
          <button
            className="btn" disabled={Boolean(screening)}
            title="Compares each resume with the job description and suggests who fits best. Nobody is rejected automatically."
            onClick={() => suggest(unscreened.map((a) => a._id))}
          >
            {screening ? `Checking ${screening.done}/${screening.total}…` : `✦ AI suggestions for ${unscreened.length}`}
          </button>
        )}
        <button className="btn" onClick={exportRows}>Export to Excel</button>
      </div>

      <Card>
        <div className="table-wrap">
          <table className="table pipeline">
            <thead>
              <tr>
                <th style={{ width: 30 }}>
                  <input
                    type="checkbox" aria-label="Select all"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r._id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r._id)) : new Set())}
                  />
                </th>
                <th>Candidate</th>
                <th>Skills</th>
                <th>Source</th>
                <th className="num" title="AI suggestion: how well the resume matches the job description">AI match</th>
                <th>Stage</th>
                <th>Interview</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8}><Empty title="No one matches these filters" /></td></tr>
              )}
              {rows.map((a) => (
                <Row
                  key={a._id}
                  app={a}
                  candidate={a.candidate}
                  job={job}
                  selected={selected.has(a._id)}
                  onToggle={() => toggle(a._id)}
                  onInvite={() => setInviting(a)}
                  onOpen={() => navigate(`/candidates/${a.candidate_id}`)}
                  menu={actions.itemsFor(a.candidate, a)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {inviting && <InviteDialog application={inviting} onClose={() => setInviting(null)} />}
      {movingStage && (
        <MoveStage
          ids={movingStage}
          current={movingStage.length === 1 ? rows.find((r) => r._id === movingStage[0])?.stage : null}
          onClose={() => { setMovingStage(null); setSelected(new Set()) }}
        />
      )}
      {actions.element}
    </>
  )
}

function Row({ app, candidate: c, job, selected, onToggle, onInvite, onOpen, menu }) {
  const [expanded, setExpanded] = useState(false)
  const sessions = sessionsFor(app._id)
  const latest = sessions[0]
  const summary = app.interview_summary
  const skills = c.parsed?.skills ?? []
  const primary = primarySkillOf(c)
  const closed = STAGES[app.stage]?.terminal

  return (
    <>
      <tr className={c.flag ? 'flagged' : ''}>
        <td><input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${app.candidate_name}`} /></td>
        <td>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn ghost sm" style={{ padding: 0, fontWeight: 600 }} onClick={onOpen}>
              {app.candidate_name}
            </button>
            <code className="mono dim small">{candidateReference(c)}</code>
            {c.flag && <span className="badge bad" title={c.flag.reason}>⚑ flagged</span>}
            {(c.tags ?? []).slice(0, 2).map((t) => <span key={t} className="badge">{t}</span>)}
          </div>
          <div className="small dim">{[c.phone, c.email].filter(Boolean).join(' · ') || 'no contact details'}</div>
          <div className="small muted">
            {[c.location?.city && `📍 ${c.location.city}`, c.total_experience_years != null && `${c.total_experience_years} yrs`, c.current_ctc_lpa != null && `₹${c.current_ctc_lpa} L`].filter(Boolean).join(' · ')}
          </div>
        </td>
        <td>
          <div className="row wrap" style={{ gap: 4, maxWidth: 200 }}>
            {primary && <span className="chip on" title="Primary skill">★ {primary}</span>}
            {skills.filter((s) => s !== primary).slice(0, 2).map((s) => <span key={s} className="chip">{s}</span>)}
            {skills.length > 3 && <span className="dim small">+{skills.length - 3}</span>}
          </div>
        </td>
        <td className="small src">
          <div>{sourceLabel(app.source?.channel)}</div>
          <div className="dim">by {app.stage_history?.[0]?.by ?? '—'} · {relative(app.created_at)}</div>
        </td>
        <td className="num">
          {app.screening ? (
            <button className="btn ghost sm" style={{ padding: 0 }} onClick={() => setExpanded((x) => !x)} title="Why this score">
              <Match value={app.screening.match_percent} />
            </button>
          ) : (
            <span className="dim small">—</span>
          )}
        </td>
        <td><Badge tone={stageTone(app.stage)}>{stageLabel(app.stage)}</Badge></td>
        <td>
          {summary?.state === 'completed' ? (
            <Badge
              tone={{ shortlist: 'good', hold: 'warn', reject: 'bad' }[summary.recommendation]}
              title={{ shortlist: 'Recommended', hold: 'Hold — review', reject: 'Not recommended' }[summary.recommendation]}
            >
              {{ shortlist: '✓', hold: '◐', reject: '✕' }[summary.recommendation]}{' '}
              {summary.overall_score != null ? `${summary.overall_score}/100` : { shortlist: 'Recommended', hold: 'Review', reject: 'No' }[summary.recommendation]}
            </Badge>
          ) : latest ? (
            <Badge tone={latest.state === 'in_progress' ? 'warn' : latest.state === 'expired' ? 'bad' : 'info'}>
              {{ invited: 'Link sent', in_progress: 'In progress', expired: 'Link expired', abandoned: 'Abandoned', cancelled: 'Cancelled' }[latest.state] ?? latest.state}
            </Badge>
          ) : app.interest?.response ? (
            <span className="small">{app.interest.response === 'interested' ? '✓ Interested' : '✕ Not interested'}</span>
          ) : (
            <span className="dim small">—</span>
          )}
        </td>
        <td className="num">
          <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
            {summary?.state === 'completed' ? (
              <Link className="btn sm" to={`/interviews/${summary.session_id}`}>Report</Link>
            ) : !closed && latest?.state !== 'invited' && latest?.state !== 'in_progress' ? (
              <button className="btn sm primary" onClick={onInvite}>Interview</button>
            ) : latest ? (
              <Link className="btn sm" to={`/interviews/${latest._id}`}>Status</Link>
            ) : null}
            <Menu items={menu} />
          </div>
        </td>
      </tr>

      {expanded && app.screening && (
        <tr>
          <td colSpan={8} style={{ background: 'var(--surface-2)' }}>
            <ScreeningDetail screening={app.screening} job={job} />
          </td>
        </tr>
      )}
    </>
  )
}

function ScreeningDetail({ screening, job }) {
  const b = screening.breakdown
  return (
    <div className="grid c2" style={{ gap: 18 }}>
      <div>
        <h4>Why this score</h4>
        <dl className="kv" style={{ marginTop: 8 }}>
          <dt>Key skills</dt><dd className="tabular">{b.required_skills} / 55</dd>
          <dt>Nice-to-have skills</dt><dd className="tabular">{b.preferred_skills} / 10</dd>
          <dt>Experience</dt><dd className="tabular">{b.experience} / 25</dd>
          <dt>Matches the JD</dt><dd className="tabular">{b.jd_relevance} / 10</dd>
        </dl>
        <div className="row wrap mt" style={{ gap: 5 }}>
          {screening.matched_skills.map((s) => <span key={s} className="chip on">✓ {s}</span>)}
          {screening.missing_skills.map((s) => <span key={s} className="chip">✕ {s}</span>)}
        </div>
      </div>
      <div>
        <h4>AI suggestion</h4>
        <div className="pre" style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>{screening.details}</div>
        <div className="note small" style={{ marginTop: 8 }}>
          A suggestion only — {screening.match_percent >= job.screening_profile.match_threshold ? 'above' : 'below'} the{' '}
          {job.screening_profile.match_threshold}% bar for {job.reference}. Nobody is rejected automatically.
        </div>
      </div>
    </div>
  )
}
