import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  completeSession, currentQuestion, getSession, recordIntegrityEvent,
} from '../services/interviews.js'
import { mmss } from '../lib/format.js'
import { useLive } from '../components/ui/useLive.js'
import { PersonaOrb } from '../components/Brand.jsx'
import { requestCamera, stopStream, useRecorder, useFacePresence } from './media.js'
import { LiveInterviewer } from './realtime.js'
import Steps from './Steps.jsx'
import { needsCamera, needsMic } from './modes.js'

// §12.5, rule 3: hard stop at the planned duration + 10 minutes, wall clock.
const GRACE_SECONDS = 10 * 60

const STATUS = {
  connecting: 'Connecting…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  listening: 'Listening…',
  idle: 'AI interviewer',
}

/**
 * The live interview: the candidate talks with the interviewer in real time
 * (OpenAI Realtime). Everything around the conversation — progress, the
 * recording, tab-switch rules, face checks, ending — works exactly as in the
 * typed session, and writes the same session document.
 *
 * If the live connection cannot be made, or drops for good, `onFallback`
 * hands over to the typed session, which picks up at the same question.
 */
export default function LiveSession({ boot, sessionId, setScreen, stream, setStream, onFallback }) {
  const session = getSession(sessionId)
  const plan = session.plan
  const rules = boot.proctoring
  const persona = plan.persona.name
  const budget = plan.rules.duration_minutes * 60

  const liveRef = useRef(null)
  const startedRef = useRef(false)
  const finishing = useRef(false)
  const nudged = useRef({ wrapUp: false, timeUp: false })
  const videoRef = useRef(null)
  const bottomRef = useRef(null)

  const [activity, setActivity] = useState('connecting')
  const [connection, setConnection] = useState('connecting')
  const [caption, setCaption] = useState('')
  const [position, setPosition] = useState(() => currentQuestion(sessionId))
  const [error, setError] = useState(null)
  const [muted, setMuted] = useState(false)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [pasteNote, setPasteNote] = useState(false)
  const [warning, setWarning] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [recordStream, setRecordStream] = useState(null)
  const [startedAt] = useState(() => (session.started_at ? new Date(session.started_at).getTime() : Date.now()))
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))

  const transcript = useLive(() => getSession(sessionId).turns, [sessionId])
  const lastLine = useMemo(() => [...transcript].reverse().find((t) => t.role === 'interviewer')?.text ?? '', [transcript])

  // The recording carries the camera plus BOTH voices, not just the candidate's.
  const recorder = useRecorder(sessionId, recordStream, session.recording?.segments ?? 0)

  const onFaceEvent = useCallback((kind) => { recordIntegrityEvent(sessionId, kind) }, [sessionId])
  useFacePresence(videoRef, rules.face_presence && needsCamera(boot) && Boolean(stream), onFaceEvent)

  async function finish(reason) {
    if (finishing.current) return
    finishing.current = true
    setSubmitting(true)
    liveRef.current?.dispose()
    try {
      await recorder.finish()
      await completeSession(sessionId, reason)
      stopStream(stream)
      setScreen('thanks')
    } catch (err) {
      finishing.current = false
      setSubmitting(false)
      setError(`The interview could not be completed. ${err.message}`)
    }
  }
  const finishRef = useRef(finish)
  useEffect(() => { finishRef.current = finish })

  const fallBack = useCallback((message) => {
    liveRef.current?.dispose()
    liveRef.current = null
    onFallback(message)
  }, [onFallback])

  // A reopened link has no stream yet; the browser remembers the permission.
  useEffect(() => {
    if (stream) return
    requestCamera({ video: needsCamera(boot) })
      .then(setStream)
      .catch(() => fallBack('We could not reach your microphone, so you can type your answers instead.'))
  }, [boot, fallBack, setStream, stream])

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream])

  // Connect once. StrictMode's dev double-mount must not open two connections.
  useEffect(() => {
    if (!stream || startedRef.current || !needsMic(boot)) return
    startedRef.current = true

    const live = new LiveInterviewer({
      sessionId,
      company: boot.company,
      mic: stream,
      on: {
        activity: setActivity,
        connection: setConnection,
        caption: setCaption,
        question: setPosition,
        error: setError,
        end: (reason) => finishRef.current(reason),
        fail: () => fallBack('We lost the live connection, so the interview continues here. Your answers so far are saved.'),
      },
    })
    liveRef.current = live

    const video = needsCamera(boot) ? stream.getVideoTracks() : []
    setRecordStream(new MediaStream([...video, live.recordingAudioTrack]))

    live.connect().catch((err) => {
      console.warn('[live interviewer]', err)
      fallBack('The live interviewer is not available right now, so questions will be read out by your browser instead.')
    })
  }, [boot, fallBack, sessionId, stream])

  // Clock and the time budget (§12.5).
  useEffect(() => {
    const t = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt) / 1000)
      setElapsed(secs)
      const live = liveRef.current
      if (!live || connection === 'connecting') return
      if (!nudged.current.wrapUp && secs > budget * 0.8) {
        nudged.current.wrapUp = true
        live.nudgeWrapUp()
      }
      if (!nudged.current.timeUp && secs > budget) {
        nudged.current.timeUp = true
        live.nudgeTimeUp()
      }
      if (secs > budget + GRACE_SECONDS) finishRef.current('time_limit')
    }, 1000)
    return () => clearInterval(t)
  }, [budget, connection, startedAt])

  // Leaving the tab: same rule as the typed session.
  useEffect(() => {
    let away = false
    const leave = () => {
      if (away || finishing.current) return
      away = true
      const n = recordIntegrityEvent(sessionId, 'tab_switches')
      if (n == null) return
      if (rules.auto_terminate && n > rules.max_tab_switches) finishRef.current('auto_terminated_tab_switches')
      else if (rules.tab_switch_warning) setWarning(n)
    }
    const back = () => { away = false }
    const onVis = () => (document.hidden ? leave() : back())
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', leave)
    window.addEventListener('focus', back)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', leave)
      window.removeEventListener('focus', back)
    }
  }, [rules.auto_terminate, rules.max_tab_switches, rules.tab_switch_warning, sessionId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript.length])

  if (submitting) {
    return (
      <div className="interview-body completion-panel" aria-live="polite">
        <span className="spin completion-spinner" />
        <div className="interview-eyebrow">Interview finished</div>
        <h1>Submitting your interview…</h1>
        <p className="muted">Keep this tab open for just a moment while we save your answers and recording.</p>
        {error && <div className="note bad mt left" role="alert">{error}</div>}
      </div>
    )
  }

  const sendTyped = () => {
    liveRef.current?.sendTyped(draft)
    setDraft('')
  }
  const toggleMute = () => {
    liveRef.current?.setMuted(!muted)
    setMuted(!muted)
  }

  const overBudget = elapsed > budget
  const left = rules.max_tab_switches - (warning ?? 0)
  const started = position.index > 0 || transcript.some((t) => t.kind === 'question')

  return (
    <>
      <div className="interview-body">
        <Steps n={4} />
        {connection === 'reconnecting' && <div className="connection-banner" role="status"><span className="spin" /> Reconnecting… your answers are saved.</div>}
        {error && <div className="note bad small mb" role="alert">{error}</div>}

        <div className="interview-stage">
          <div className="persona-panel">
            <PersonaOrb
              size={64}
              speaking={activity === 'speaking'}
              listening={activity === 'listening' && !muted}
              label={`${persona}, AI interviewer`}
            />
            <div>
              <strong>{persona}</strong>
              <div className="small muted">{muted ? 'You are muted' : STATUS[activity]}</div>
              <div className="small dim">Live conversation</div>
            </div>
          </div>
          {stream && needsCamera(boot) && (
            <div className="self-view-wrap">
              <video ref={videoRef} autoPlay playsInline muted className="self-view" />
              {recorder.recording && <span className="rec-dot">● REC</span>}
            </div>
          )}
          {stream && !needsCamera(boot) && recorder.recording && <span className="rec-dot inline">● Recording audio</span>}
        </div>

        <div className="between interview-status mb">
          <span>
            {started
              ? <><strong>Question {Math.min(position.index + 1, position.total)}</strong> of {position.total}</>
              : <strong>Introduction</strong>}
          </span>
          <span className={overBudget ? 'badge warn' : 'tabular'}>
            {overBudget ? 'Wrapping up' : `${mmss(Math.max(0, budget - elapsed))} remaining`}
          </span>
        </div>
        <div className="bar interview-progress mb">
          <span style={{ width: `${(started ? (position.index + 1) / position.total : 0) * 100}%` }} />
        </div>

        {/* Captions always on (§17.4): what the interviewer is saying, live. */}
        <div className="qtext mb" aria-live="polite">
          {caption || lastLine || <span className="muted">{persona} will start speaking in a moment…</span>}
        </div>
        <p className="small muted mb">
          Just answer out loud, as you would to a person. {persona} listens until you finish and may ask one follow-up.
          Headphones help: they stop your speakers echoing into the microphone.
        </p>

        <div className="transcript interview-transcript">
          {transcript.map((t) => (
            <div key={t.seq} className={`bubble ${t.role}`}>
              <span className="who">{t.role === 'interviewer' ? persona : 'You'}{t.typed ? ' · typed' : ''}</span>
              {t.text}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {typing && (
          <div className="mt">
            <label className="qmeta" htmlFor="live-typed">Type your answer</label>
            <textarea
              id="live-typed"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={() => {
                if (!rules.paste_detection) return
                recordIntegrityEvent(sessionId, 'paste_events')
                setPasteNote(true)
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendTyped() }}
              placeholder="Type here if speaking is difficult. ⌘/Ctrl + Enter to send."
            />
            <div className="row mt" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={sendTyped} disabled={!draft.trim()}>Send</button>
            </div>
            {pasteNote && <div className="note warn small mt">Pasted text is noted in your report. Answers in your own words are best.</div>}
          </div>
        )}
      </div>

      <div className="interview-foot row">
        <button
          className="btn"
          onClick={() => confirm('End the interview here? Everything you have answered so far will still be scored.') && finish('candidate_ended')}
        >
          End interview
        </button>
        <div style={{ flex: 1 }} />
        <button className={`btn ${muted ? 'danger' : ''}`} onClick={toggleMute}>{muted ? '🔇 Unmute' : '🎤 Mute'}</button>
        <button className="btn" onClick={() => liveRef.current?.askToRepeat()} disabled={connection !== 'connected'}>🔊 Repeat</button>
        <button className={`btn ${typing ? 'primary' : ''}`} onClick={() => setTyping(!typing)}>⌨ Type</button>
      </div>

      {warning != null && (
        <div className="backdrop">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="live-warn-title">
            <div className="modal-body">
              <div className="completion-icon warn">!</div>
              <h2 id="live-warn-title" style={{ textAlign: 'center' }}>Please stay on this tab</h2>
              <p style={{ textAlign: 'center' }} className="muted">You left the interview tab. This has been noted in your report.</p>
              {rules.auto_terminate && (
                <div className={`note ${left <= 0 ? 'bad' : 'warn'}`}>
                  <strong>Warning {warning} of {rules.max_tab_switches}.</strong>{' '}
                  {left <= 0
                    ? 'If you leave the tab again, the interview will end automatically.'
                    : `${left} more warning${left === 1 ? '' : 's'} before the interview ends automatically.`}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn primary block" onClick={() => setWarning(null)} autoFocus>Return to the interview</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
