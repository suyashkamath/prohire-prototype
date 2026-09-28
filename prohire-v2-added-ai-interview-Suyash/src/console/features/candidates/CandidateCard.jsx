import { Menu } from '../../../components/ui/index.jsx'
import { candidateReference, primarySkillOf } from '../../../services/candidates.js'
import { sourceLabel } from '../../../domain/locations.js'
import { stageLabel } from '../../../domain/stages.js'
import { initials, relative } from '../../../lib/format.js'

/**
 * One candidate, laid out the way recruiters already read Naukri Resdex:
 * experience · CTC · location on top, then Current / Previous / Education /
 * Pref. locations / Key skills as labelled rows, contact on the right.
 */
export default function CandidateCard({ c, highlight, onOpen, onAddToJob, menu, selected, onToggle }) {
  const words = String(highlight ?? '').toLowerCase().split(/[\s,]+/).filter((w) => w.length > 1)
  const mark = (text) => {
    if (!words.length || !text) return text
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
    return String(text).split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
  }
  const role = (r) => r?.title ? `${r.title}${r.company ? ` at ${r.company}` : ''}` : null
  const previous = c.parsed?.employment?.[1] ?? null
  const primary = primarySkillOf(c)
  const skills = c.parsed?.skills ?? []

  return (
    <div className={`cand-card ${c.flag ? 'flagged' : ''}`}>
      <div className="cand-main">
        <div className="row" style={{ gap: 8 }}>
          {onToggle && <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${c.full_name}`} />}
          <button className="cand-name" onClick={onOpen}>{mark(c.full_name)}</button>
          <code className="mono dim small">{candidateReference(c)}</code>
          {c.flag && <span className="badge bad" title={c.flag.reason}>⚑ {c.flag.reason}</span>}
          {(c.tags ?? []).map((t) => <span key={t} className="badge">{t}</span>)}
        </div>
        <div className="cand-facts">
          <span>💼 {c.total_experience_years != null ? `${Math.floor(c.total_experience_years)}y ${Math.round((c.total_experience_years % 1) * 12)}m` : '—'}</span>
          <span>₹ {c.current_ctc_lpa != null ? `${c.current_ctc_lpa} Lacs` : '—'}</span>
          <span>📍 {c.location?.city ?? '—'}</span>
          {c.notice_period_days != null && <span>⏱ {c.notice_period_days === 0 ? 'Immediate' : `${c.notice_period_days} days notice`}</span>}
        </div>
        <dl className="cand-rows">
          {role(c.current) && <><dt>Current</dt><dd>{mark(role(c.current))}</dd></>}
          {role(previous) && <><dt>Previous</dt><dd>{mark(role(previous))}</dd></>}
          {c.parsed?.education?.[0] && <><dt>Education</dt><dd>{mark(typeof c.parsed.education[0] === 'string' ? c.parsed.education[0] : c.parsed.education[0].degree)}</dd></>}
          {(c.preferred_locations ?? []).length > 0 && <><dt>Pref. locations</dt><dd>{c.preferred_locations.join(', ')}</dd></>}
          <dt>Key skills</dt>
          <dd className="cand-skills">
            {skills.length === 0 ? <span className="dim">—</span> : skills.map((s, i) => (
              <span key={s}>{i > 0 && <span className="sep"> | </span>}{s === primary ? <strong>{mark(s)}</strong> : mark(s)}</span>
            ))}
          </dd>
          {c.applications?.length > 0 && (
            <>
              <dt>Jobs</dt>
              <dd>{c.applications.map((a) => `${a.job_reference} · ${stageLabel(a.stage)}`).join('   ')}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="cand-side">
        <span className="avatar lg">{initials(c.full_name)}</span>
        <div className="small">{c.phone ?? <span className="dim">no phone</span>}</div>
        <div className="small truncate" style={{ maxWidth: 190 }}>{c.email ?? <span className="dim">no email</span>}</div>
        {c.phone && <a className="btn sm" href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()}>📞 Call</a>}
        <button className="btn sm primary" onClick={onAddToJob}>Add to job</button>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn ghost sm" onClick={onOpen}>View</button>
          <Menu items={menu} />
        </div>
      </div>
      <div className="cand-foot small dim">
        {sourceLabel(c.source?.channel)} · added by {c.created_by} · {relative(c.created_at)}
        {c.consent?.data_processing === 'granted' && ' · ✓ consent'}
      </div>
    </div>
  )
}
