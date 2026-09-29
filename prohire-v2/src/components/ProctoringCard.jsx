// Proctoring for an AI video interview: what the camera and microphone checks
// found (InterviewBot: web/proctor.js, bot/voice_check.py, bot/integrity.py).
//
// Read top to bottom: is there anything to look at → the measurements → each
// sign, with the moments to watch. Nothing here changes a score; a serious
// sign only stops an automatic "Recommended".

import { Card, Badge } from './ui/index.jsx'
import { mmss } from '../lib/format.js'

const LEVEL = {
  none: { tone: 'good', label: 'No signs found' },
  low: { tone: 'warn', label: 'Worth a look' },
  medium: { tone: 'warn', label: 'Worth a look' },
  high: { tone: 'bad', label: 'Serious signs' },
}

const secs = (n) => (n == null ? '—' : n < 1 ? '0 s' : n < 90 ? `${Math.round(n)} s` : mmss(n))
const pct = (share) => (share == null ? '—' : `${Math.round(share * 100)}%`)

function voiceLine(v) {
  if (!v || v.status === 'not_run') return 'Checked after the interview'
  if (v.status === 'off') return 'Not checked (turned off on the server)'
  if (v.status === 'no_audio') return 'Not checked (no microphone audio)'
  if (v.status === 'failed') return 'The check could not run'
  if (v.prompted) return 'Someone may have been telling them what to say'
  return v.other_seconds ? `Another voice for ${secs(v.other_seconds)}` : 'None heard'
}

/**
 * @param integrity   the report's integrity (level, verdict, signals with times)
 * @param fairness    the session's measurements (see domain/interviewBot.js)
 * @param onSeek      seconds from the start → play the recording there
 */
export default function ProctoringCard({ integrity, fairness, durationSeconds, onSeek }) {
  const level = LEVEL[integrity?.level] ?? LEVEL.none
  const signals = integrity?.signals ?? []
  const strengthOf = (kinds) => {
    const hit = signals.filter((s) => kinds.includes(s.kind))
    return hit.some((s) => s.strength === 'serious') ? 'bad' : hit.length ? 'warn' : null
  }
  const f = fairness ?? {}
  const s = f.seconds ?? {}
  const cameraOn = f.camera === 'on'
  const share = (n) => (durationSeconds && n ? ` · ${Math.round((n / durationSeconds) * 100)}% of the time` : '')

  const rows = [
    ['Face in view', cameraOn ? pct(f.face_visible_share) : cameraLabel(f), ['camera', 'no_face']],
    ['Looking away from the screen', cameraOn ? secs(s.looking_away) + share(s.looking_away) : '—', ['looking_away']],
    ['Another person on camera', cameraOn ? secs(s.multiple_faces) : '—', ['multiple_faces']],
    ['A phone in view', cameraOn && f.people_check === 'faces and people' ? secs(s.phone_visible) : '—', ['phone_visible']],
    ['A voice while their lips were still', cameraOn ? secs(s.voice_without_lips) : '—', ['voice_without_lips']],
    ['Eye movement like reading', f.answers_checked ? `${f.reading_answers} of ${f.answers_checked} answers` : '—', ['reading']],
    ['Left the interview tab', `${integrity?.tab_switches ?? f.tab_switches ?? 0}×`, ['tab_switch']],
    ['Another window in front', secs(f.window_away_seconds), ['window_blur']],
    ['Other voices on the microphone', voiceLine(f.voice_check), ['other_voice']],
  ]
  if (f.second_display) rows.push(['Second display', 'Connected', ['second_display']])
  if (f.virtual_camera) rows.push(['Camera software', f.virtual_camera, ['virtual_camera']])

  return (
    <Card title="Proctoring">
      <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
        <Badge tone={level.tone} className="lg">{level.label}</Badge>
      </div>
      {integrity?.verdict && <p className="small" style={{ marginTop: 0 }}>{integrity.verdict}</p>}
      {integrity?.auto_terminated && (
        <div className="note bad small mb"><strong>Ended automatically</strong> — {integrity.reason}.</div>
      )}

      <dl className="kv small proctor-stats">
        {rows.map(([label, value, kinds]) => {
          const tone = strengthOf(kinds)
          return (
            <div key={label} style={{ display: 'contents' }}>
              <dt>{label}</dt>
              <dd className={tone === 'bad' ? 'bad-text' : tone === 'warn' ? 'warn-text' : ''}>{value}</dd>
            </div>
          )
        })}
      </dl>

      {signals.length > 0 && (
        <>
          <h4 className="section-title" style={{ marginTop: 16 }}>What to check</h4>
          <ul className="proctor-signals">
            {signals.map((sig, i) => (
              <li key={i} className={sig.strength === 'serious' ? 'serious' : ''}>
                <div className="between" style={{ alignItems: 'flex-start' }}>
                  <strong>{sig.label ?? sig.kind}</strong>
                  <Badge tone={sig.strength === 'serious' ? 'bad' : 'warn'}>{sig.strength === 'serious' ? 'serious' : 'review'}</Badge>
                </div>
                {sig.detail && <div className="small muted" style={{ marginTop: 3 }}>{sig.detail}</div>}
                {sig.times?.some((t) => t != null) && (
                  <div className="row wrap no-print" style={{ gap: 4, marginTop: 6 }}>
                    {sig.times.filter((t) => t != null).map((t, k) => (
                      <button key={k} className="chip" onClick={() => onSeek?.(t)} title="Play the recording from here">▶ {mmss(t)}</button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="hint mt">
        {checksLine(f)} Signs are never scored; a serious one turns “Recommended” into “Hold” so a person
        decides after watching. “No signs” means nothing was found, not proof.
      </div>
    </Card>
  )
}

function cameraLabel(f) {
  if (f.camera === 'running') return 'Measured when the interview ends'
  if (f.camera === 'unavailable') return 'Camera check could not run'
  return 'Not received'
}

function checksLine(f) {
  const camera = f.camera === 'on'
    ? `Camera checked (${f.people_check === 'faces and people' ? 'faces, people and phones' : 'faces'}).`
    : f.camera === 'running' ? 'Camera check in progress.' : 'The camera check did not run.'
  return camera
}
