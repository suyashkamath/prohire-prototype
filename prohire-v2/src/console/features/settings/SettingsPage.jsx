import { useRef, useState } from 'react'

import { useLive } from '../../../components/ui/useLive.js'
import { Card, Field, Select, Confirm } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import { db } from '../../../lib/db.js'
import { getSettings, updateSettings, getEmailTemplate, saveEmailTemplate, resetEmailTemplate } from '../../../services/core.js'
import { orgTemplate, saveTemplate } from '../../../services/interviews.js'
import { STRICTNESS, INTERVIEW_MODES } from '../../../domain/resolvePlan.js'
import { languageOptions, ALLOWED_DURATIONS } from '../../../domain/locations.js'
import { DEFAULT_TEMPLATES, PLACEHOLDERS } from '../../../domain/emailTemplates.js'
import { PersonaOrb } from '../../../components/Brand.jsx'
import { seed, isSeeded } from '../../../lib/seed.js'
import { botStatus, DEFAULT_BOT_URL } from '../../../services/interviewBot.js'
import { BOT_LANGUAGES } from '../../../domain/interviewBot.js'

export default function SettingsPage() {
  const toast = useToast()
  const fileRef = useRef(null)
  const [confirming, setConfirming] = useState(null)
  const [seeding, setSeeding] = useState(null)

  const data = useLive(() => ({
    settings: getSettings(),
    org: orgTemplate(),
    stats: db.stats(),
    bytes: db.bytes(),
    seeded: isSeeded(),
  }))

  const { settings, org } = data

  const patchOrgRules = (patch) =>
    saveTemplate({ ...org, rules: { ...org.rules, ...patch } })

  function exportData() {
    const blob = new Blob([JSON.stringify(db.dump(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `prohire-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('Exported.', 'good')
  }

  async function importData(file) {
    try {
      db.load(JSON.parse(await file.text()))
      toast('Imported. Everything on screen now comes from that file.', 'good')
    } catch (err) {
      toast(`Could not import: ${err.message}`, 'bad')
    }
  }

  return (
    <>
      <div className="topbar"><h1>Settings</h1></div>

      <div className="page">
        <div className="grid split">
          <div className="col">
            <Card title="Organisation">
              <Field label="Name">
                <input
                  type="text" value={settings.org_name}
                  onChange={(e) => updateSettings({ org_name: e.target.value })}
                />
              </Field>
              <Field
                label={<span className="row" style={{ gap: 8 }}><PersonaOrb size={22} /> AI interviewer&rsquo;s name</span>}
                hint="What candidates see and hear. Always introduced as an AI, never as a person."
              >
                <input
                  type="text" value={settings.persona_name}
                  onChange={(e) => {
                    updateSettings({ persona_name: e.target.value })
                    saveTemplate({ ...org, persona: { ...org.persona, name: e.target.value } })
                  }}
                />
              </Field>
              <Field
                label={`AI suggestion bar — ${settings.match_threshold}%`}
                hint="Resumes above this are suggested as a good fit. Each job can set its own. Nobody is rejected automatically."
              >
                <input
                  type="range" min="40" max="95" value={settings.match_threshold} style={{ width: '100%' }}
                  onChange={(e) => updateSettings({ match_threshold: Number(e.target.value) })}
                />
              </Field>
            </Card>

            <Card title="Interview defaults">
              <p className="small muted">
                Used when a job has no settings of its own. Each job can change these, and each
                candidate can still get different settings when invited.
              </p>
              <Field label="Format" hint="The screening round is always the AI video interview.">
                <div className="fixed-value">{INTERVIEW_MODES.call.label} — {INTERVIEW_MODES.call.detail}</div>
              </Field>

              <Field label="Strictness">
                <Select
                  options={Object.entries(STRICTNESS).map(([k, v]) => ({ value: k, label: `${v.label} — pass at ${v.threshold}` }))}
                  value={org.rules.strictness} onChange={(v) => patchOrgRules({ strictness: v })}
                />
              </Field>
              <div className="grid c2">
                <Field label="Language">
                  <Select
                    options={languageOptions().filter((o) => BOT_LANGUAGES.includes(o.value))}
                    value={BOT_LANGUAGES.includes(org.rules.language) ? org.rules.language : 'en-IN'}
                    onChange={(v) => patchOrgRules({ language: v })}
                  />
                </Field>
                <Field label="Duration">
                  <Select
                    options={ALLOWED_DURATIONS.map((d) => ({ value: String(d), label: `${d} minutes` }))}
                    value={String(org.rules.duration_minutes)}
                    onChange={(v) => patchOrgRules({ duration_minutes: Number(v) })}
                  />
                </Field>
              </div>
              <Field label="Maximum questions">
                <input
                  type="number" min="1" max="20" value={org.rules.max_questions}
                  onChange={(e) => patchOrgRules({ max_questions: Number(e.target.value) })}
                />
              </Field>
            </Card>
            <VoiceInterviewCard settings={settings} />
            <EmailTemplates />
            <CareerPortalCard />
          </div>

          <div className="col">
            <Card title="Storage">
              <div className="note info mb">
                This prototype has <strong>no server yet</strong>. Everything is saved in this browser only
                (interview videos too) — clearing site data erases it. Export a backup before anything drastic.
              </div>
              <dl className="kv small">
                {data.stats.filter((s) => s.count > 0).map((s) => (
                  <div key={s.collection} style={{ display: 'contents' }}>
                    <dt>{s.collection.replace(/_/g, ' ')}</dt>
                    <dd className="tabular">{s.count}</dd>
                  </div>
                ))}
                <dt><strong>Size</strong></dt>
                <dd className="tabular"><strong>{(data.bytes / 1024).toFixed(1)} KB</strong></dd>
              </dl>

              <div className="row wrap mt">
                <button className="btn" onClick={exportData}>Export JSON</button>
                <button className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
                <input
                  ref={fileRef} type="file" accept="application/json" hidden
                  onChange={(e) => e.target.files[0] && importData(e.target.files[0])}
                />
              </div>
            </Card>

            <Card title="Demo data">
              {data.seeded ? (
                <p className="small muted">
                  Demo data is loaded. Reset everything below to start from an empty system.
                </p>
              ) : (
                <>
                  <p className="small muted">
                    Two departments, three jobs and six candidates — screened by the real engine, not
                    pre-filled numbers.
                  </p>
                  <button
                    className="btn primary" disabled={Boolean(seeding)}
                    onClick={async () => {
                      setSeeding('Working…')
                      try {
                        await seed({ onProgress: setSeeding })
                        toast('Demo data loaded.', 'good')
                      } finally {
                        setSeeding(null)
                      }
                    }}
                  >
                    {seeding ?? 'Load demo data'}
                  </button>
                </>
              )}
            </Card>

            <Card title="Danger zone">
              <p className="small muted">
                Erases every department, job, candidate, application, interview and report in this
                browser. There is no undo and no backup on a server — because there is no server.
              </p>
              <button className="btn danger" onClick={() => setConfirming(true)}>Reset everything</button>
            </Card>
          </div>
        </div>
      </div>

      {confirming && (
        <Confirm
          title="Erase all data?"
          tone="danger"
          confirmLabel="Erase everything"
          onClose={() => setConfirming(null)}
          onConfirm={() => { db.reset(); toast('Everything erased.') }}
          body={
            <>
              <p>
                This deletes all {data.stats.reduce((s, x) => s + x.count, 0)} records from this
                browser. It cannot be undone.
              </p>
              <p className="small muted">
                Export first if there is anything here you want to keep.
              </p>
            </>
          }
        />
      )}
    </>
  )
}

function EmailTemplates() {
  const toast = useToast()
  const [key, setKey] = useState('interview_invite')
  const tpl = useLive(() => getEmailTemplate(key), [key])
  const [draft, setDraft] = useState(null)
  const f = draft ?? tpl
  const set = (k) => (e) => setDraft({ ...f, [k]: e.target.value })

  return (
    <Card title="Email templates">
      <Field label="Template">
        <Select
          options={Object.entries(DEFAULT_TEMPLATES).map(([k, v]) => ({ value: k, label: v.name }))}
          value={key} onChange={(v) => { setKey(v); setDraft(null) }}
        />
      </Field>
      <Field label="CC (always copied)"><input type="text" value={f.cc ?? ''} onChange={set('cc')} placeholder="hr@company.com" /></Field>
      <Field label="Subject"><input type="text" value={f.subject} onChange={set('subject')} /></Field>
      <Field label="Message" hint={<>Placeholders: {PLACEHOLDERS.map((p) => <code key={p} style={{ marginRight: 4 }}>{`{{${p}}}`}</code>)}</>}>
        <textarea rows={12} value={f.body} onChange={set('body')} />
      </Field>
      <div className="row">
        <button className="btn primary" disabled={!draft} onClick={() => { saveEmailTemplate(key, { cc: f.cc, subject: f.subject, body: f.body }); setDraft(null); toast('Template saved.', 'good') }}>Save template</button>
        <button className="btn ghost" onClick={() => { resetEmailTemplate(key); setDraft(null); toast('Back to the default wording.') }}>Reset to default</button>
      </div>
    </Card>
  )
}

/**
 * The connection to the company's own career page. ProHire hosts no career
 * page; the official one reads the job feed and posts applications here.
 */
function CareerPortalCard() {
  const toast = useToast()
  const settings = useLive(() => getSettings())
  const key = settings.career_portal_key
  const newKey = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(18))
    updateSettings({ career_portal_key: `phk_live_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` })
    toast('New key created. Give it to whoever manages the career page.', 'good')
  }
  return (
    <Card title="Official career page">
      <p className="small muted" style={{ marginTop: 0 }}>
        Jobs you mark &ldquo;List on the official career page&rdquo; are offered to it, and every
        application there arrives in the job&rsquo;s pipeline with the resume, tagged Career portal.
      </p>
      <dl className="kv small">
        <dt>Job feed</dt><dd><code>GET /api/v1/career-portal/jobs</code></dd>
        <dt>Applications</dt><dd><code>POST /api/v1/career-portal/applications</code></dd>
        <dt>Key</dt>
        <dd>{key ? <code style={{ wordBreak: 'break-all' }}>{key}</code> : <span className="dim">not created yet</span>}</dd>
      </dl>
      <div className="row mt">
        <button className="btn" onClick={newKey}>{key ? 'Replace key' : 'Create key'}</button>
      </div>
      <div className="hint mt">
        Hand <code>docs/career-portal-integration.md</code> to the career page&rsquo;s developer — it
        has every field. The endpoints go live with the ProHire backend; until then, use
        &ldquo;Test: simulate an application&rdquo; on a job.
      </div>
    </Card>
  )
}

/**
 * Where the AI voice interview runs: the InterviewBot server, which holds the
 * Sarvam keys and the HR mailbox settings. Only its address is kept here.
 */
function VoiceInterviewCard({ settings }) {
  const [status, setStatus] = useState(null)
  const [checking, setChecking] = useState(false)
  const check = async () => {
    setChecking(true)
    setStatus(await botStatus())
    setChecking(false)
  }
  return (
    <Card title="AI video interview">
      <p className="small muted">
        The AI video interview runs on the InterviewBot server (see <code className="mono">InterviewBot/README.md</code>).
        Its Sarvam keys and the HR mailbox are set in that server’s <code className="mono">.env</code>, never here.
      </p>
      <Field label="Server address" hint="Where this console reaches the interview server. Candidates get the address set as PUBLIC_URL on that server.">
        <div className="row">
          <input
            type="url" value={settings.interview_bot_url ?? DEFAULT_BOT_URL}
            onChange={(e) => { updateSettings({ interview_bot_url: e.target.value.trim() }); setStatus(null) }}
          />
          <button className="btn" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check'}</button>
        </div>
      </Field>
      {status && (
        !status.reachable ? <div className="note bad small">{status.error}</div>
        : !status.ready ? <div className="note warn small">Reachable, but missing: {status.missing.join(', ')}.</div>
        : <div className="note good small">Ready. {status.email ? 'Invites are emailed from the HR mailbox.' : 'The HR mailbox is not set up, so invites open in the recruiter’s mail app.'}</div>
      )}
    </Card>
  )
}
