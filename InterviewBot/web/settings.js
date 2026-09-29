// Settings, in three steps: 1 Job (settings + questions) → 2 Candidate → 3 Review & start.

const $ = (id) => document.getElementById(id)
const api = async (path, opts = {}) => {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.detail || `Request failed (${res.status})`)
  return body
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// The settings every layer can set. Blank = inherit from the layer above.
const FIELDS = [
  { key: 'language', label: 'Language', type: 'select', options: ['English', 'Hindi'] },
  { key: 'strictness', label: 'Strictness', type: 'select', options: ['lenient', 'moderate', 'strict'] },
  { key: 'duration_minutes', label: 'Length (minutes)', type: 'number' },
  { key: 'max_questions', label: 'Max questions', type: 'number' },
  { key: 'follow_ups_per_question', label: 'Follow-ups per question', type: 'number' },
  { key: 'interviewer_name', label: "Interviewer's name", type: 'text' },
  { key: 'voice_speaker', label: 'Sarvam voice (speaker)', type: 'text', hint: "empty = agent's voice" },
  { key: 'max_tab_switches', label: 'Tab switches before ending', type: 'number' },
  { key: 'answer_pause_seconds', label: 'Pause that ends an answer (seconds)', type: 'number', step: 0.5, hint: '2.5 (default); 1–8' },
]
const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]))
const STEPS = ['job', 'candidate', 'review']

let company, jobs, candidates

// --- steps -----------------------------------------------------------------------

function go(step) {
  if (!STEPS.includes(step)) step = 'job'
  STEPS.forEach((s) => { $(`step-${s}`).hidden = s !== step })
  $('past').hidden = step !== 'review'
  document.querySelectorAll('.step').forEach((b) => {
    const i = STEPS.indexOf(b.dataset.step)
    b.classList.toggle('on', b.dataset.step === step)
    b.classList.toggle('done', i < STEPS.indexOf(step))
    b.setAttribute('aria-current', b.dataset.step === step ? 'step' : 'false')
  })
  if (location.hash !== `#${step}`) history.replaceState(null, '', `#${step}`)
  if (step === 'review') preview()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// --- form pieces -------------------------------------------------------------------

function renderFields(container, values, inheritFrom) {
  container.innerHTML = FIELDS.map((f) => {
    const v = values?.[f.key] ?? ''
    const inherited = inheritFrom?.[f.key]
    const ph = inherited != null && inherited !== '' ? `${inherited} (inherited)` : f.hint ?? ''
    if (f.type === 'select') {
      return `<label>${f.label}<select data-key="${f.key}"><option value="">${esc(inherited != null && inherited !== '' ? `— ${inherited} (inherited)` : '—')}</option>${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`
    }
    return `<label>${f.label}<input data-key="${f.key}" type="${f.type}" value="${esc(v)}" placeholder="${esc(ph)}" ${f.type === 'number' ? `min="0" step="${f.step ?? 1}"` : ''}></label>`
  }).join('')
}

function readFields(container) {
  const out = {}
  container.querySelectorAll('[data-key]').forEach((el) => {
    if (el.value !== '') out[el.dataset.key] = el.type === 'number' ? Number(el.value) : el.value
  })
  return out
}

function renderQuestions(container, questions) {
  container.innerHTML = ''
  questions.forEach((q) => addQuestionRow(container, q))
  renumber(container)
}

function renumber(container) {
  const rows = [...container.querySelectorAll('.qcard')]
  rows.forEach((row, i) => { row.querySelector('.qnum').textContent = `Question ${i + 1}` })
  if (!rows.length) container.innerHTML = '<div class="small dim">No questions yet.</div>'
}

function addQuestionRow(container, q = {}) {
  container.querySelector(':scope > .dim')?.remove()
  const row = document.createElement('div')
  row.className = 'qcard'
  row.innerHTML = `
    <div class="between">
      <b class="qnum small"></b>
      <div class="row">
        <label class="inline"><input type="checkbox" data-f="must_ask" ${q.must_ask ? 'checked' : ''}> Always ask</label>
        <button class="icon" data-act="up" aria-label="Move up">↑</button>
        <button class="icon" data-act="down" aria-label="Move down">↓</button>
        <button class="icon danger" data-act="remove" aria-label="Remove question">✕</button>
      </div>
    </div>
    <label>Question (English)<textarea rows="2" data-f="text" placeholder="Type the question">${esc(q.text)}</textarea></label>
    <label>Hindi version (optional)<textarea rows="2" data-f="text_hi" lang="hi" placeholder="Used when the interview is in Hindi">${esc(q.text_hi)}</textarea></label>`
  row.dataset.id = q.id || ''
  row.dataset.skill = q.skill || ''
  row.querySelector('[data-act=remove]').onclick = () => { row.remove(); renumber(container) }
  row.querySelector('[data-act=up]').onclick = () => { row.previousElementSibling?.before(row); renumber(container) }
  row.querySelector('[data-act=down]').onclick = () => { row.nextElementSibling?.after(row); renumber(container) }
  container.appendChild(row)
  renumber(container)
  return row
}

function readQuestions(container) {
  return [...container.querySelectorAll('.qcard')].map((row, i) => ({
    id: row.dataset.id || `q${Date.now()}${i}`,
    text: row.querySelector('[data-f=text]').value,
    text_hi: row.querySelector('[data-f=text_hi]').value,
    must_ask: row.querySelector('[data-f=must_ask]').checked,
    skill: row.dataset.skill || null,
  })).filter((q) => q.text.trim())
}

const currentJob = () => jobs.find((j) => j.id === $('job').value)
const currentCand = () => candidates.find((c) => c.id === $('candidate').value)

// --- step 1: job ----------------------------------------------------------------------

function showJob() {
  const j = currentJob()
  $('jobInfo').innerHTML = `<b>${esc(j.reference)} · ${esc(j.title)}</b> — ${esc(j.department)}, ${esc(j.location)}<br>Primary skill: <b>${esc(j.primary_skill)}</b>${j.primary_skill_min_years ? ` (${j.primary_skill_min_years}+ years)` : ''} · Skills: ${esc(j.skills_required.join(', '))}`
  const s = j.interview?.settings ?? {}
  renderFields($('jobSettings'), s, company.settings)
  $('jobInstructions').value = s.instructions ?? ''
  renderQuestions($('questions'), j.interview?.questions ?? [])
  $('jobSaved').textContent = `Version ${j.version ?? 1}`
  const list = candidates.filter((c) => c.applying_for === j.id)
  $('candidate').innerHTML = list.map((c) => `<option value="${c.id}">${esc(c.name)} — ${esc(c.current?.title ?? '')}</option>`).join('')
  showCandidate()
}

async function saveJob() {
  const settings = { ...readFields($('jobSettings')), instructions: $('jobInstructions').value }
  const saved = await api(`/api/jobs/${currentJob().id}`, { method: 'PUT', body: JSON.stringify({ settings, questions: readQuestions($('questions')) }) })
  jobs = jobs.map((j) => (j.id === saved.id ? saved : j))
  $('jobSaved').textContent = `Saved — version ${saved.version}`
}

// --- step 2: candidate ------------------------------------------------------------------

function showCandidate() {
  const c = currentCand()
  if (!c) return
  const j = currentJob()
  const cur = c.current ?? {}
  $('candInfo').innerHTML = `<b>${esc(c.name)}</b> · ${esc(c.reference ?? '')}<br>${esc([cur.title && `${cur.title}${cur.company ? ` at ${cur.company}` : ''}`, c.experience_years != null && `${c.experience_years} years`, c.location].filter(Boolean).join(' · '))}${c.skills?.length ? `<br>Skills: ${esc(c.skills.slice(0, 10).join(', '))}` : ''}`
  const inherited = { ...company.settings, ...(j.interview?.settings ?? {}) }
  renderFields($('candSettings'), c.overrides, inherited)
  $('candInstructions').value = c.overrides?.instructions ?? ''
  renderQuestions($('candQuestions'), c.extra_questions ?? [])
  $('candSaved').textContent = `Version ${c.version ?? 1}`
}

async function saveCand() {
  const overrides = { ...readFields($('candSettings')), instructions: $('candInstructions').value }
  const saved = await api(`/api/candidates/${currentCand().id}`, { method: 'PUT', body: JSON.stringify({ overrides, extra_questions: readQuestions($('candQuestions')) }) })
  candidates = candidates.map((c) => (c.id === saved.id ? saved : c))
  $('candSaved').textContent = `Saved — version ${saved.version}`
}

// --- step 3: review & start -------------------------------------------------------------

async function preview() {
  $('previewOut').innerHTML = '<div class="small dim">Loading…</div>'
  try {
    const out = await api('/api/preview', { method: 'POST', body: JSON.stringify({ job_id: currentJob().id, candidate_id: currentCand().id }) })
    const p = out.plan
    const FROM = { company: 'Company default', job: 'Job', candidate: 'This candidate', interview: 'This interview' }
    const rows = Object.entries(p.settings)
      .filter(([k, v]) => LABEL[k] || (k === 'instructions' && v))
      .map(([k, v]) => `<tr><td>${esc(LABEL[k] ?? 'Instructions')}</td><td><b>${esc(v || '—')}</b></td><td class="dim">${esc(FROM[p.settings_from[k]] ?? '')}</td></tr>`).join('')
    const qs = p.questions.map((q) => `<li>${esc(q.asked_as)}${q.must_ask ? ' <span class="chip accent">always ask</span>' : ''}${q.in_english_only ? ' <span class="chip">no Hindi version — asked in English</span>' : ''}</li>`).join('')
    $('previewOut').innerHTML = `
      <div class="note small"><b>${esc(p.candidate.name)}</b> · ${esc(p.job.reference)} ${esc(p.job.title)}</div>
      <h3>Settings</h3>
      <div class="table-wrap"><table><tr><th>Setting</th><th>Value</th><th>Comes from</th></tr>${rows}</table></div>
      <h3>Questions (${p.questions.length})</h3>
      <ol class="qlist">${qs}</ol>
      <details><summary class="small">What Sarvam receives</summary><pre>${esc(JSON.stringify(out.sarvam, null, 2))}</pre></details>`
  } catch (e) { $('previewOut').innerHTML = `<div class="note bad">${esc(e.message)}</div>` }
}

async function start() {
  try {
    const out = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ job_id: currentJob().id, candidate_id: currentCand().id }) })
    window.open(out.url, '_blank')
    $('startMsg').innerHTML = `Interview opened in a new tab. <a href="${out.url}" target="_blank">Open again</a>`
    loadSessions()
  } catch (e) { $('startMsg').textContent = e.message }
}

async function loadSessions() {
  const rows = await api('/api/sessions')
  $('sessions').innerHTML = rows.length
    ? `<div class="table-wrap"><table><tr><th>When</th><th>Candidate</th><th>Job</th><th>Language</th><th>Status</th><th>Turns</th><th></th></tr>${rows.map((s) => `<tr><td>${new Date(s.created_at).toLocaleString()}</td><td>${esc(s.candidate)}</td><td>${esc(s.job)}</td><td>${esc(s.language)}</td><td>${esc(s.status)}${s.end_reason ? ` · ${esc(s.end_reason.replace(/_/g, ' '))}` : ''}</td><td>${s.turns}</td><td><a href="/session/${s.id}">Review</a></td></tr>`).join('')}</table></div>`
    : 'None yet.'
}

// Save the step, then move on. A failed save stays on the step with the reason.
const saveThen = (save, label, next) => async () => {
  try { await save(); go(next) } catch (e) { $(label).textContent = e.message }
}

async function init() {
  const st = await api('/api/status')
  $('status').innerHTML = st.ready
    ? ''
    : `<div class="note warn small"><b>Before an interview can connect</b>, add these to <code>InterviewBot/.env</code>: ${st.missing.map(esc).join(', ')}. You can still edit settings.</div>`
  ;[company, jobs, candidates] = await Promise.all([api('/api/company'), api('/api/jobs'), api('/api/candidates')])
  $('version').textContent = `Company defaults v${company.version}`
  $('job').innerHTML = jobs.map((j) => `<option value="${j.id}">${esc(j.reference)} · ${esc(j.title)}</option>`).join('')
  $('job').onchange = showJob
  $('candidate').onchange = showCandidate
  $('addQuestion').onclick = () => addQuestionRow($('questions')).querySelector('textarea').focus()
  $('addCandQuestion').onclick = () => addQuestionRow($('candQuestions')).querySelector('textarea').focus()
  $('jobNext').onclick = saveThen(saveJob, 'jobSaved', 'candidate')
  $('candNext').onclick = saveThen(saveCand, 'candSaved', 'review')
  $('candBack').onclick = () => go('job')
  $('reviewBack').onclick = () => go('candidate')
  $('start').onclick = start
  document.querySelectorAll('.step').forEach((b) => { b.onclick = () => go(b.dataset.step) })
  window.addEventListener('hashchange', () => go(location.hash.slice(1)))
  showJob()
  go(location.hash.slice(1) || 'job')
  loadSessions()
}
init().catch((e) => { $('status').innerHTML = `<div class="note bad">${esc(e.message)}</div>` })
