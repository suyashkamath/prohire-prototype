// Review page: the report (from the candidate's answers), then the conversation,
// recording, events and the settings the interview ran with.

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const id = location.pathname.split('/').pop()
const ten = (v) => (v == null ? '—' : Number(v).toFixed(1))

const OUTCOME = {
  shortlist: { label: 'Recommended', cls: 'good' },
  hold: { label: 'Hold — review', cls: 'warn' },
  reject: { label: 'Not recommended', cls: 'bad' },
  insufficient: { label: 'Not enough evidence', cls: 'warn' },
}
const mmss = (sec) => (sec == null ? '' : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`)
// A time in the interview that jumps the video there.
const seek = (sec) => (sec == null ? '' : `<a href="#" class="seek" data-t="${Number(sec)}">▶ ${mmss(sec)}</a>`)

const FAIR = {
  none: { label: 'No signs found', cls: 'good' },
  review: { label: 'Worth a look', cls: 'warn' },
  serious: { label: 'Serious signs', cls: 'bad' },
}
const CHECKS = {
  camera: { on: 'checked', unavailable: 'could not run in the browser', not_received: 'no result from the browser' },
  voice: { done: 'checked', off: 'turned off', no_audio: 'no audio saved', failed: 'failed — press Re-generate to retry', not_run: 'not run' },
}
const EVENT_LABEL = {
  tab_switch: 'Left the tab', window_blur: 'Another window in front', multiple_faces: 'Another person on camera', phone_visible: 'Phone in view',
  no_face: 'Out of view', looking_away: 'Looking away', voice_without_lips: 'Voice, lips still',
}

// Proctoring: every sign of unfair means, with times that jump the video there.
function renderFairness(f) {
  if (!f.signals) return `<p style="margin:0">${esc(f.verdict)}</p><div class="small dim">Tab switches: ${f.tab_switches}</div>`   // older reports
  const lvl = FAIR[f.level] ?? FAIR.review
  const rows = f.signals.map((x) => `
    <li class="signal ${x.strength}">
      <div><span class="chip ${x.strength === 'serious' ? 'bad' : 'warn'}">${x.strength === 'serious' ? 'Serious' : 'Review'}</span> <b>${esc(x.label)}</b></div>
      ${x.detail ? `<div class="small muted">${esc(x.detail)}</div>` : ''}
      ${x.times?.length ? `<div class="small">${x.times.map(seek).join(' ')}</div>` : ''}
    </li>`).join('')
  const checks = Object.entries(f.checks ?? {}).filter(([k]) => CHECKS[k]).map(([k, v]) => `${k === 'camera' ? 'Camera' : 'Other voices'}: ${CHECKS[k][v] ?? v}`).join(' · ')
  return `
    <div class="row"><span class="badge ${lvl.cls}">${lvl.label}</span><span class="small muted">${esc(f.verdict)}</span></div>
    ${rows ? `<ul class="plain-list signals">${rows}</ul>` : ''}
    <div class="small dim">${checks}${checks ? ' · ' : ''}Tab switches: ${f.tab_switches}. ${esc(f.note ?? '')}</div>`
}

const SOFT = [['fluency', 'Fluency'], ['confidence', 'Confidence'], ['composure', 'Composure'], ['communication', 'Communication']]

function tile(value, label, big) {
  return `<div class="tile ${big ? 'big' : ''}"><div class="tile-v">${ten(value)}<span> / 10</span></div><div class="small muted">${esc(label)}</div></div>`
}

function list(title, items) {
  return items?.length ? `<div><h3>${title}</h3><ul class="plain-list">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''
}

function renderReport(r) {
  if (!r) return '<div class="small muted">No report yet. It is made automatically when an interview ends — or press Generate report.</div>'
  const o = OUTCOME[r.outcome] ?? OUTCOME.hold
  const ev = r.evidence
  const skills = r.skills.map((s) => `
    <tr>
      <td><div class="small dim">${s.primary ? 'Primary skill' : 'Key skill'}</div><b>${esc(s.skill)}</b></td>
      ${s.asked
        ? `<td>${s.evidence ? `“${esc(s.evidence)}”` : `<span class="dim">${esc(s.strength)}</span>`}${s.evidence && s.strength ? `<div class="small dim">${esc(s.strength)}</div>` : ''}</td><td>${esc(s.improvement)}</td><td>${esc(s.interpretation)}</td>`
        : '<td colspan="3" class="dim">No questions asked</td>'}
      <td class="num"><b>${s.score == null ? '–' : ten(s.score)}</b><span class="dim">/10</span></td>
    </tr>`).join('')
  const soft = SOFT.map(([k, label]) => {
    const v = r.soft_skills?.[k] ?? {}
    return `<div class="tile" title="${esc(v.reason)}"><div class="tile-v">${ten(v.score)}<span> / 10</span></div><div class="small muted">${label}</div>${v.reason ? `<div class="small dim">${esc(v.reason)}</div>` : ''}</div>`
  }).join('')
  const qs = (r.questions ?? []).map((q) => `<li>${q.answered ? '✓' : '✕'} <b>${esc(q.question)}</b>${q.summary ? `<div class="small muted">${esc(q.summary)}</div>` : ''}</li>`).join('')

  return `
    <div class="outcome">
      <div><div class="small dim">Assessment outcome</div><span class="badge ${o.cls}">${o.label}</span></div>
      <div class="small muted">${r.overall != null ? `Overall <b>${ten(r.overall)}/10</b> · pass mark ${ten(r.pass_mark)}` : ''}<br>${ev.candidate_words} words · ${ev.answered}/${ev.planned} questions answered</div>
    </div>
    ${r.error ? `<div class="note warn small">${esc(r.rationale)}</div>` : ''}
    ${!ev.enough && !r.error ? `<div class="note warn small"><b>Not enough evidence.</b> ${esc(r.rationale)}</div>` : ''}

    <div class="cols">
      <div><h3>Overall scores</h3><div class="tiles">${tile(r.technical, 'Technical skill score', true)}${tile(r.soft, 'Soft skill score', true)}</div>
        <div class="small dim">Technical = average of the skills asked. Soft = average of the four below.</div></div>
      <div><h3>Soft skills</h3><div class="tiles">${soft}</div></div>
    </div>

    <h3>Skill analysis</h3>
    <div class="table-wrap"><table class="skills"><tr><th>Skill</th><th>Key strength</th><th>Improvement area</th><th>AI interpretation</th><th class="num">Score</th></tr>${skills}</table></div>
    <div class="small dim">A skill not asked about is not scored and does not count against the candidate. Quotes are the candidate's exact words.</div>

    ${r.summary ? `<div><h3>Interview summary</h3><p style="margin:0">${esc(r.summary)}</p></div>` : ''}
    <div><h3>Recommendation rationale</h3><p style="margin:0"><b>Reason:</b> ${esc(r.rationale)}</p>${r.observations?.length ? `<ul class="plain-list">${r.observations.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>

    <div class="cols">${list('Strengths', r.strengths)}${list('Concerns', r.concerns)}</div>
    ${list('Ask in the next round', r.ask_next_round)}
    <div><h3>Proctoring</h3>${renderFairness(r.proctoring)}</div>

    ${qs ? `<details><summary class="small">Questions covered (${ev.answered}/${ev.planned})</summary><ol class="plain-list">${qs}</ol></details>` : ''}
    <div class="note warn small"><b>Disclaimer.</b> This assessment is AI-generated from the candidate's answers to help the recruiter. Weigh it with your own judgement — a person makes the hiring decision.</div>
    <div class="small dim">Scored by ${esc(r.model ?? '—')} · ${new Date(r.generated_at).toLocaleString()}</div>`
}

async function load() {
  const s = await (await fetch(`/api/sessions/${id}`)).json()
  const p = s.plan
  const at = (iso) => (s.started_at ? (new Date(iso) - new Date(s.started_at)) / 1000 : null)
  $('title').textContent = `${p.candidate.name} · ${p.job.title}`
  $('meta').textContent = `${p.settings.language} · ${p.settings.strictness} · ${s.status}${s.end_reason ? ` (${s.end_reason.replace(/_/g, ' ')})` : ''}`
  $('report').innerHTML = renderReport(s.report)
  $('makeReport').textContent = s.report ? 'Re-generate report' : 'Generate report'
  $('makeReport').disabled = !s.turns.some((t) => t.role === 'candidate')
  if ($('makeReport').disabled) $('reportMsg').textContent = 'The candidate has not answered anything yet.'
  $('turns').innerHTML = s.turns.length ? s.turns.map((t) => `<div class="bubble ${t.role}"><span class="who">${t.role === 'candidate' ? esc(p.candidate.name) : esc(p.settings.interviewer_name)} · ${mmss(at(t.at))}</span>${esc(t.text)}</div>`).join('') : '<div class="muted">No conversation recorded.</div>'
  if (s.recording) $('recording').innerHTML = `<video id="video" controls src="/api/sessions/${id}/recording" style="width:100%;border-radius:8px"></video><a href="/api/sessions/${id}/recording" download>Download video</a>`
  if (s.events.length) {
    $('events').innerHTML = s.events.map((e) => {
      const secs = e.detail?.seconds
      const from = e.detail?.from_s ?? (at(e.at) == null ? null : Math.max(0, at(e.at) - (secs ?? 0)))
      return `<div>${esc(EVENT_LABEL[e.kind] ?? e.kind.replace(/_/g, ' '))} ${seek(from)}${secs ? ` <span class="dim">(${secs} s)</span>` : ''}</div>`
    }).join('')
  }
  $('plan').innerHTML = `<table>${Object.entries(p.settings).map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td>${esc(v)}</td><td class="dim">${esc(p.settings_from[k])}</td></tr>`).join('')}</table><ol>${p.questions.map((q) => `<li>${esc(q.asked_as)}</li>`).join('')}</ol>`
  return s
}

// ▶ 3:12 → play the video from there.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a.seek')
  if (!a) return
  e.preventDefault()
  const v = $('video')
  if (!v) return
  v.currentTime = Number(a.dataset.t)
  v.play().catch(() => {})
  v.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

$('makeReport').onclick = async () => {
  $('makeReport').disabled = true
  $('reportMsg').textContent = 'Scoring the answers… this takes up to a minute.'
  try {
    const res = await fetch(`/api/sessions/${id}/report`, { method: 'POST' })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Failed (${res.status})`)
    $('reportMsg').textContent = ''
    await load()
  } catch (e) {
    $('reportMsg').textContent = e.message
    $('makeReport').disabled = false
  }
}

// A report made in the background right after the interview may still be on its way.
load().then((s) => {
  if (!s.report && s.status === 'ended' && s.turns.some((t) => t.role === 'candidate')) {
    $('reportMsg').textContent = 'Preparing the report…'
    let tries = 0
    const t = setInterval(async () => {
      const again = await load()
      if (again.report || ++tries > 12) { clearInterval(t); $('reportMsg').textContent = again.report ? '' : 'Still not ready — press Generate report.' }
    }, 5000)
  }
})
