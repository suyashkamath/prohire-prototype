import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import {
  bootstrap, recordConsent, startSession, currentQuestion, askQuestion,
  submitAnswer, completeSession, recordIntegrityEvent, getSession, submitQualification,
} from '../services/interviews.js'
import { mmss } from '../lib/format.js'
import { useLive } from '../components/ui/useLive.js'
import { PersonaOrb } from '../components/Brand.jsx'
import { INTERVIEW_MODES } from '../domain/resolvePlan.js'
import {
  speak, stopSpeaking, canSpeak, useVoicesReady, useDictation, requestCamera, stopStream,
  useRecorder, useFacePresence,
} from './media.js'
import LiveSession from './LiveSession.jsx'
import { liveInterviewerAvailable } from './realtime.js'
import Steps from './Steps.jsx'
import { needsCamera, needsMic } from './modes.js'

/**
 * The candidate surface.
 *
 * welcome → consent → device check → [questionnaire] → [interview] → thank you.
 * No login, no navigation into the ATS, nothing about any other candidate, and
 * never the rubric.
 *
 * What is deliberately not disguised: this is an AI interviewer, and the first
 * screen says so.
 */
export default function InterviewApp() {
  const { token } = useParams()
  const [boot, setBoot] = useState(() => bootstrap(token))
  const [screen, setScreen] = useState(() => firstScreen(boot))
  const [sessionId, setSessionId] = useState(() => boot.session_id ?? null)
  // The camera stream is held here so it survives the move from the device
  // check into the interview without asking for permission twice.
  const [stream, setStream] = useState(null)

  useEffect(() => () => stopStream(stream), [stream])

  // Which engine conducts a spoken interview (§10.3): the live interviewer
  // when the server has OpenAI configured, otherwise the browser's own voice.
  // Typed interviews always use the typed session.
  const [engine, setEngine] = useState(() => (boot.error || !needsMic(boot) ? 'classic' : null))
  const [engineNote, setEngineNote] = useState(null)
  useEffect(() => {
    if (boot.error || !needsMic(boot)) return
    let cancelled = false
    liveInterviewerAvailable().then((ok) => { if (!cancelled) setEngine(ok ? 'live' : 'classic') })
    return () => { cancelled = true }
  }, [boot])
  const fallBack = useCallback((message) => {
    setEngineNote(message)
    setEngine('classic')
  }, [])

  if (boot.error) {
    return (
      <Shell title="Interview">
        <div className="note bad">{boot.error}</div>
      </Shell>
    )
  }

  /** Where to go once the device check (or the questionnaire) is done. */
  const next = (b = bootstrap(token)) => {
    setBoot(b)
    if (b.assessment_type !== 'interview' && !b.qualification_done && b.qualification.length) return setScreen('qualification')
    if (b.question_count > 0) return setScreen('session')
    return setScreen('finishing')
  }

  const common = { boot, token, setScreen, sessionId, setSessionId, stream, setStream, next, engine }

  return (
    <div className="interview-shell">
      <div className="interview-card">
        <div className="interview-head">
          <PersonaOrb size={38} label={`${boot.persona.name}, AI interviewer`} />
          <div className="interview-title">
            <strong>{boot.job_title}</strong>
            <div className="small muted">
              {boot.company} · Interview with {boot.persona.name} · {boot.persona.language_label}
            </div>
          </div>
          <span className="interview-ai-badge"><span /> AI interview</span>
        </div>

        {screen === 'welcome' && <Welcome {...common} />}
        {screen === 'consent' && <Consent {...common} />}
        {screen === 'check' && <DeviceCheck {...common} />}
        {screen === 'qualification' && <Qualification {...common} />}
        {screen === 'session' && engine === null && <div className="interview-body"><span className="spin" /></div>}
        {screen === 'session' && engine === 'live' && <LiveSession {...common} onFallback={fallBack} />}
        {screen === 'session' && engine === 'classic' && <Session {...common} notice={engineNote} />}
        {screen === 'finishing' && <Finishing {...common} />}
        {screen === 'thanks' && <Thanks {...common} />}
        {screen === 'declined' && <Declined boot={boot} />}
      </div>
    </div>
  )
}

function firstScreen(boot) {
  if (boot.error) return 'welcome'
  // Reopening an active link resumes where the candidate was, rather than
  // making them repeat onboarding. The session cursor is the source of truth.
  if (boot.state !== 'in_progress') return 'welcome'
  if (boot.assessment_type !== 'interview' && !boot.qualification_done && boot.qualification.length) return 'qualification'
  return boot.question_count > 0 ? 'session' : 'finishing'
}

function Shell({ title, children }) {
  return (
    <div className="interview-shell">
      <div className="interview-card">
        <div className="interview-head">
          <PersonaOrb size={34} />
          <strong>{title ?? 'Interview'}</strong>
        </div>
        <div className="interview-body">{children}</div>
      </div>
    </div>
  )
}

function Welcome({ boot, setScreen }) {
  const typeLabel = {
    interview: `${boot.question_count} questions`,
    qualification: `${boot.qualification.length} quick questions`,
    both: `${boot.qualification.length + boot.question_count} total`,
  }[boot.assessment_type]

  return (
    <>
      <div className="interview-body">
        <Steps n={1} />
        <div className="interview-eyebrow">Your interview is ready</div>
        <h1 className="interview-hero-title">Hello{boot.candidate_name ? `, ${boot.candidate_name.split(' ')[0]}` : ''}.</h1>
        <p className="interview-lead">
          You have been invited to interview for <strong>{boot.job_title}</strong> at {boot.company}. Take a
          breath — this is designed to feel like a focused conversation, not a speed test.
        </p>

        <div className="interview-facts">
          <div><span className="fact-icon">◷</span><strong>{boot.duration_minutes} min</strong><small>Approx. length</small></div>
          <div><span className="fact-icon">◎</span><strong>{typeLabel}</strong><small>Questions</small></div>
          <div><span className="fact-icon">文</span><strong>{boot.persona.language_label}</strong><small>Language</small></div>
          <div><span className="fact-icon">◉</span><strong>{boot.question_count ? INTERVIEW_MODES[boot.mode]?.label ?? 'Typed' : 'Typed'}</strong><small>Format</small></div>
        </div>

        <div className="ai-disclosure mt">
          <PersonaOrb size={34} />
          <div>
            <strong>You’ll speak with {boot.persona.name}, an AI interviewer</strong>
            <p>
              {boot.persona.name} reads each question aloud and may ask one follow-up when an answer
              needs more detail. You can speak or type your answers. A recruiter reviews the result
              and makes every hiring decision.
            </p>
          </div>
        </div>

        <div className="note mt small">
          <strong>Before you start:</strong> use a charged laptop or phone
          {needsCamera(boot) ? ' with a camera and microphone' : needsMic(boot) ? ' with a microphone' : ''}, sit
          somewhere quiet, and <strong>stay on this tab</strong>.
          {boot.proctoring.tab_switch_warning && boot.proctoring.auto_terminate &&
            ` Leaving the tab is flagged; after ${boot.proctoring.max_tab_switches} warnings the interview ends automatically.`}
        </div>

        <p className="reassurance mt">✓ Your place is saved if you close the tab or lose connection.</p>
      </div>
      <div className="interview-foot">
        <button className="btn primary block lg interview-cta" onClick={() => setScreen('consent')}>Continue to consent <span>→</span></button>
      </div>
    </>
  )
}

function Consent({ boot, token, setScreen }) {
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState(null)

  const respond = (granted) => {
    try {
      recordConsent(token, granted)
      setScreen(granted ? 'check' : 'declined')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <div className="interview-body">
        <Steps n={2} />
        <div className="interview-eyebrow">Privacy &amp; consent</div>
        <h1 className="screen-title">Before we start</h1>
        <p>Your answers are recorded so a recruiter can review them. Specifically:</p>
        <ul className="consent-list">
          {needsCamera(boot)
            ? <li>Your <strong>video and audio</strong> are recorded, along with a transcript of your answers.</li>
            : <li>A transcript of everything you say or type is kept.</li>}
          <li>It is shared with the recruiting team for <strong>{boot.job_title}</strong> at {boot.company}.</li>
          <li>Leaving this tab, pasting text{boot.proctoring.face_presence && needsCamera(boot) ? ', and leaving the camera frame' : ''} are noted in the report.</li>
          <li>It is kept for 180 days and then deleted, as required by the DPDP Act.</li>
          <li>It is <strong>not</strong> used to train any AI model.</li>
          <li>The AI scores your answers. A person makes the decision.</li>
        </ul>

        <label className={`consent-check mt ${agreed ? 'checked' : ''}`}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span><strong>I understand and agree</strong><small>to this interview being recorded and evaluated as described above.</small></span>
        </label>

        {error && <div className="note bad mt" role="alert">{error}</div>}
      </div>
      <div className="interview-foot consent-actions">
        <button className="btn ghost" onClick={() => respond(false)}>I don’t consent</button>
        <div className="row">
          <button className="btn" onClick={() => setScreen('welcome')}>Back</button>
          <button className="btn primary lg" disabled={!agreed} onClick={() => respond(true)}>
            I agree — continue <span>→</span>
          </button>
        </div>
      </div>
    </>
  )
}

function Declined({ boot }) {
  return (
    <div className="interview-body completion-panel">
      <div className="completion-icon neutral">✓</div>
      <div className="interview-eyebrow">Your choice is recorded</div>
      <h1>That’s completely okay.</h1>
      <p className="muted">
        You have not consented to the AI interview for <strong>{boot.job_title}</strong>. This is not a
        rejection and no interview answers have been recorded.
      </p>
      <div className="note mt left">
        Contact the recruiter who sent this link if you would prefer a human interview or need another arrangement.
      </div>
    </div>
  )
}

/**
 * The device check: connection, saving, camera and microphone. A camera that
 * will not start is not a dead end — the candidate can continue without video
 * and the report says so.
 */
function DeviceCheck({ boot, token, setScreen, setSessionId, stream, setStream, next, engine }) {
  const [checks, setChecks] = useState(null)
  const [cam, setCam] = useState(needsMic(boot) ? 'pending' : 'skip')
  const [camError, setCamError] = useState(null)
  const [error, setError] = useState(null)
  const videoRef = useRef(null)
  const voicesReady = useVoicesReady()

  useEffect(() => {
    const t = setTimeout(() => {
      setChecks({
        online: navigator.onLine,
        storage: (() => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true } catch { return false } })(),
      })
    }, 500)
    return () => clearTimeout(t)
  }, [])

  const enableCamera = useCallback(async () => {
    setCam('asking')
    setCamError(null)
    try {
      const s = await requestCamera({ video: needsCamera(boot) })
      setStream(s)
      setCam('ok')
    } catch (err) {
      setCam('failed')
      setCamError(err.name === 'NotAllowedError' ? 'Permission was denied. Allow camera and microphone in your browser’s address bar, then try again.' : err.message)
    }
  }, [boot, setStream])

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream, cam])

  const speaks = voicesReady && canSpeak(boot.speech_lang)
  const ready = checks && checks.online && checks.storage && cam !== 'pending' && cam !== 'asking'

  function begin() {
    try {
      startSession(token, {
        user_agent: navigator.userAgent,
        platform: navigator.platform,
        camera: cam === 'ok' && needsCamera(boot),
        microphone: cam === 'ok',
      })
      const b = bootstrap(token)
      setSessionId(b.session_id)
      next(b)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <div className="interview-body">
        <Steps n={3} />
        <div className="interview-eyebrow">Almost there</div>
        <h1 className="screen-title">Quick setup check</h1>

        {!checks ? (
          <div className="checking-panel" aria-live="polite"><span className="spin" /> Checking your browser…</div>
        ) : (
          <div className="device-checks">
            <CheckRow ok={checks.online} title="Internet connection" detail={checks.online ? 'Connected and ready' : 'You appear to be offline'} />
            <CheckRow ok={checks.storage} title="Answer saving" detail={checks.storage ? 'Your progress can be saved' : 'Enable site data to continue'} />
            {engine === 'live' && (
              <CheckRow
                ok
                title={`Live conversation with ${boot.persona.name}`}
                detail={`${boot.persona.name} will talk with you in real time, in ${boot.persona.language_label}. Headphones give the best result.`}
              />
            )}
            {boot.question_count > 0 && engine !== 'live' && (
              <CheckRow
                ok={speaks} soft
                title={`${boot.persona.name}'s voice`}
                detail={speaks ? `Questions will be read aloud in ${boot.persona.language_label}` : `Your browser has no ${boot.persona.language_label} voice — questions will be shown on screen`}
              />
            )}
          </div>
        )}

        {cam !== 'skip' && (
          <div className="camera-check mt">
            {cam === 'ok' && needsCamera(boot) ? (
              <video ref={videoRef} autoPlay playsInline muted className="self-view large" />
            ) : (
              <div className="camera-placeholder">{cam === 'ok' ? '🎙 Microphone ready' : needsCamera(boot) ? '📷' : '🎙'}</div>
            )}
            <div>
              <strong>{needsCamera(boot) ? 'Camera and microphone' : 'Microphone'}</strong>
              <p className="small muted" style={{ margin: '4px 0 10px' }}>
                {cam === 'ok'
                  ? needsCamera(boot) ? 'Looking good. Make sure your face is well lit and centred.' : 'Ready. You can speak your answers.'
                  : needsCamera(boot) ? 'This interview is recorded on video. Your browser will ask for permission.' : 'Speak your answers instead of typing. Your browser will ask for permission.'}
              </p>
              {cam !== 'ok' && (
                <div className="row wrap">
                  <button className="btn primary" onClick={enableCamera} disabled={cam === 'asking'}>
                    {cam === 'asking' ? 'Waiting for permission…' : cam === 'failed' ? 'Try again' : needsCamera(boot) ? 'Turn on camera' : 'Turn on microphone'}
                  </button>
                  <button className="btn ghost" onClick={() => setCam('declined')} disabled={cam === 'asking'}>
                    {cam === 'failed' ? 'Continue without it' : 'I can’t use one'}
                  </button>
                </div>
              )}
              {camError && <div className="note bad small mt" role="alert">{camError}</div>}
              {cam === 'declined' && <div className="note warn small mt">You are continuing without {needsCamera(boot) ? 'video' : 'a microphone'}. The recruiter will see this in the report.</div>}
            </div>
          </div>
        )}

        {error && <div className="note bad mt" role="alert">{error}</div>}
      </div>
      <div className="interview-foot row">
        <button className="btn" onClick={() => setScreen('consent')}>Back</button>
        <button className="btn primary lg" style={{ flex: 1 }} disabled={!ready} onClick={begin}>
          Start <span>→</span>
        </button>
      </div>
    </>
  )
}

function CheckRow({ ok, title, detail, soft }) {
  return (
    <div className={`check-row ${ok ? 'ok' : soft ? 'soft' : 'failed'}`}>
      <span>{ok ? '✓' : soft ? 'i' : '!'}</span>
      <div><strong>{title}</strong><small>{detail}</small></div>
    </div>
  )
}

/** The questionnaire: short typed answers, one screen, done in two minutes. */
function Qualification({ boot, sessionId, next }) {
  const [answers, setAnswers] = useState({})
  const [error, setError] = useState(null)
  const set = (id, v) => setAnswers((a) => ({ ...a, [id]: v }))
  const missing = boot.qualification.filter((q) => answers[q.id] == null || String(answers[q.id]).trim() === '')

  const submit = () => {
    try {
      submitQualification(sessionId, answers)
      next()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <div className="interview-body">
        <Steps n={4} />
        <div className="interview-eyebrow">A few quick questions</div>
        <h1 className="screen-title">Tell us about yourself</h1>
        <p className="muted">These take about two minutes.{boot.question_count > 0 && ` Your interview with ${boot.persona.name} starts right after.`}</p>

        <div className="col mt" style={{ gap: 16 }}>
          {boot.qualification.map((q, i) => (
            <div key={q.id} className="field">
              <label htmlFor={`q-${q.id}`}>{i + 1}. {q.text}</label>
              {q.kind === 'yes_no' ? (
                <div className="row">
                  {['yes', 'no'].map((v) => (
                    <button
                      key={v} type="button"
                      className={`btn ${answers[q.id] === v ? 'primary' : ''}`}
                      onClick={() => set(q.id, v)}
                    >
                      {v === 'yes' ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              ) : q.kind === 'choice' ? (
                <select id={`q-${q.id}`} value={answers[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)}>
                  <option value="">Select</option>
                  {(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  id={`q-${q.id}`}
                  type={q.kind === 'number' ? 'number' : 'text'}
                  inputMode={q.kind === 'number' ? 'decimal' : undefined}
                  value={answers[q.id] ?? ''}
                  onChange={(e) => set(q.id, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
        {error && <div className="note bad mt" role="alert">{error}</div>}
      </div>
      <div className="interview-foot row">
        <span className="small muted">{missing.length ? `${missing.length} left to answer` : 'All answered'}</span>
        <div style={{ flex: 1 }} />
        <button className="btn primary lg" disabled={missing.length > 0} onClick={submit}>
          {boot.question_count > 0 ? 'Continue to interview' : 'Submit'} <span>→</span>
        </button>
      </div>
    </>
  )
}

/** Questionnaire-only sessions complete here; there is nothing else to ask. */
function Finishing({ sessionId, setScreen }) {
  const [error, setError] = useState(null)
  useEffect(() => {
    let cancelled = false
    completeSession(sessionId, 'all_questions_answered')
      .then(() => { if (!cancelled) setScreen('thanks') })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [sessionId, setScreen])
  return (
    <div className="interview-body completion-panel" aria-live="polite">
      <span className="spin completion-spinner" />
      <h1>Submitting…</h1>
      {error && <div className="note bad mt left" role="alert">{error}</div>}
    </div>
  )
}

function Session({ boot, sessionId, setScreen, stream, setStream, notice }) {
  const session = getSession(sessionId)
  const [state, setState] = useState(() => currentQuestion(sessionId))
  const [answer, setAnswer] = useState('')
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [speaking, setSpeaking] = useState(false)
  const [warning, setWarning] = useState(null)
  const [pasteNote, setPasteNote] = useState(false)
  const [startedAt] = useState(() => (session?.started_at ? new Date(session.started_at).getTime() : Date.now()))
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
  // The transcript is read straight from storage rather than copied into local
  // state, so every write re-renders it without a manual sync.
  const transcript = useLive(() => getSession(sessionId).turns, [sessionId])
  const startedRef = useRef(startedAt)
  const answerStart = useRef(startedAt)
  const bottomRef = useRef(null)
  const videoRef = useRef(null)
  const finishing = useRef(false)
  const voicesReady = useVoicesReady()

  const lang = boot.speech_lang
  const spoken = (boot.mode === 'video' || boot.mode === 'voice') && voicesReady && canSpeak(lang)
  const budget = session.plan.rules.duration_minutes * 60
  const rules = boot.proctoring

  // A resumed session (the tab was closed and reopened) has no stream yet.
  // Ask again — the browser remembers the permission, so this is silent.
  useEffect(() => {
    if (stream || !needsMic(boot) || session.device?.microphone === false) return
    requestCamera({ video: needsCamera(boot) }).then(setStream).catch(() => {})
  }, [boot, session.device?.microphone, setStream, stream])

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream])

  const recorder = useRecorder(sessionId, needsCamera(boot) || needsMic(boot) ? stream : null, session.recording?.segments ?? 0)

  const onFaceEvent = useCallback((kind) => { recordIntegrityEvent(sessionId, kind) }, [sessionId])
  useFacePresence(videoRef, rules.face_presence && needsCamera(boot) && Boolean(stream), onFaceEvent)

  const dictation = useDictation(lang, (phrase) => setAnswer((a) => (a ? `${a.trimEnd()} ${phrase}` : phrase)))

  useEffect(() => {
    if (!currentQuestion(sessionId).done) askQuestion(sessionId)
  }, [sessionId])

  const pending = state?.pending_follow_up
  const questionText = pending ?? state?.question?.text

  // Read each new question aloud, once.
  useEffect(() => {
    if (!spoken || !questionText) return
    speak(questionText, lang, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) })
    return () => stopSpeaking()
  }, [spoken, questionText, lang])

  async function finish(reason) {
    if (finishing.current) return
    finishing.current = true
    setThinking(true)
    setError(null)
    stopSpeaking()
    dictation.stop()
    try {
      await recorder.finish()
      await completeSession(sessionId, reason)
      stopStream(stream)
      setScreen('thanks')
    } catch (err) {
      finishing.current = false
      setError(`The interview could not be completed. ${err.message}`)
      setThinking(false)
    }
  }
  // Listeners registered once read the latest `finish` through a ref, so they
  // are not torn down and re-added on every render.
  const finishRef = useRef(finish)
  useEffect(() => { finishRef.current = finish })

  // A refresh can land after the final answer was saved but before the report
  // finished. Complete that transition instead of trapping the candidate.
  useEffect(() => {
    if (state?.done) finishRef.current('all_questions_answered')
  }, [state?.done])

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const connected = () => setOnline(true)
    const disconnected = () => setOnline(false)
    window.addEventListener('online', connected)
    window.addEventListener('offline', disconnected)
    return () => {
      window.removeEventListener('online', connected)
      window.removeEventListener('offline', disconnected)
    }
  }, [])

  // Leaving the tab. Counted once per departure (a blur and a hide in quick
  // succession are one departure), warned on return, and — past the limit —
  // the interview ends. The rule is the recruiter's, set per job or candidate.
  useEffect(() => {
    let away = false
    const leave = () => {
      if (away || finishing.current) return
      away = true
      const n = recordIntegrityEvent(sessionId, 'tab_switches')
      if (n == null) return
      if (rules.auto_terminate && n > rules.max_tab_switches) {
        finishRef.current('auto_terminated_tab_switches')
      } else if (rules.tab_switch_warning) {
        setWarning(n)
      }
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript.length, thinking])

  if (!state) return <div className="interview-body"><span className="spin" /></div>
  if (state.done) {
    return (
      <div className="interview-body completion-panel" aria-live="polite">
        <span className="spin completion-spinner" />
        <div className="interview-eyebrow">All questions answered</div>
        <h1>Submitting your interview…</h1>
        <p className="muted">Keep this tab open for just a moment while we save your answers{stream ? ' and recording' : ''}.</p>
        {error && <div className="note bad mt left" role="alert">{error}</div>}
      </div>
    )
  }

  async function send() {
    const text = answer.trim()
    if (!text) return
    dictation.stop()
    stopSpeaking()
    setThinking(true)
    setError(null)
    setAnswer('')
    try {
      const result = await submitAnswer(sessionId, text, {
        durationSeconds: Math.round((Date.now() - answerStart.current) / 1000),
      })
      answerStart.current = Date.now()
      if (result.done) {
        await finish('all_questions_answered')
        return
      }
      if (!result.follow_up) askQuestion(sessionId)
      setState(currentQuestion(sessionId))
    } catch (err) {
      setAnswer(text)
      setError(`Your answer could not be saved. ${err.message}`)
    } finally {
      if (!finishing.current) setThinking(false)
    }
  }

  const overBudget = elapsed > budget
  const left = rules.max_tab_switches - (warning ?? 0)

  return (
    <>
      <div className="interview-body">
        <Steps n={4} />
        {!online && <div className="connection-banner" role="status"><span className="spin" /> Reconnecting… your saved answers are safe.</div>}
        {notice && <div className="note info small mb" role="status">{notice}</div>}

        <div className="interview-stage">
          <div className="persona-panel">
            <PersonaOrb size={64} speaking={speaking} listening={dictation.listening} label={`${session.plan.persona.name}, AI interviewer`} />
            <div>
              <strong>{session.plan.persona.name}</strong>
              <div className="small muted">
                {speaking ? 'Speaking…' : dictation.listening ? 'Listening…' : thinking ? 'Thinking…' : 'AI interviewer'}
              </div>
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
          <span><strong>Question {Math.min(state.index + 1, state.total)}</strong> of {state.total}</span>
          <span className={overBudget ? 'badge warn' : 'tabular'}>
            {overBudget ? 'Wrap up when you can' : `${mmss(Math.max(0, budget - elapsed))} remaining`}
          </span>
        </div>
        <div className="bar interview-progress mb"><span style={{ width: `${((state.index + 1) / state.total) * 100}%` }} /></div>

        <div className="transcript interview-transcript">
          {transcript.map((t) => (
            <div key={t.seq} className={`bubble ${t.role}`}>
              <span className="who">{t.role === 'interviewer' ? session.plan.persona.name : 'You'}</span>
              {t.text}
            </div>
          ))}
          {thinking && <div className="bubble interviewer" aria-live="polite"><span className="spin" /> <span className="muted">{session.plan.persona.name} is thinking…</span></div>}
          <div ref={bottomRef} />
        </div>

        {pending && <div className="note info mb small">Follow-up — answer this before we move on.</div>}

        <div className="between">
          <label className="qmeta" htmlFor="interview-answer">{pending ? 'Follow-up from your interviewer' : `Question ${state.index + 1}`}</label>
          {spoken && (
            <button className="btn ghost sm" onClick={() => speak(questionText, lang, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) })}>
              🔊 Repeat
            </button>
          )}
        </div>
        <div className="qtext mb">{questionText}</div>

        <textarea
          id="interview-answer"
          rows={6} value={dictation.listening && dictation.interim ? `${answer} ${dictation.interim}`.trim() : answer}
          onChange={(e) => setAnswer(e.target.value)}
          onPaste={() => {
            if (!rules.paste_detection) return
            recordIntegrityEvent(sessionId, 'paste_events')
            setPasteNote(true)
          }}
          placeholder={dictation.supported ? 'Press “Speak” and answer out loud, or type here. Specific examples score better than general statements.' : 'Type your answer. Specific examples score better than general statements.'}
          disabled={thinking}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
        />
        <div className="answer-meta">
          <span>{answer.trim().split(/\s+/).filter(Boolean).length} words</span>
          <span>⌘/Ctrl + Enter to send</span>
        </div>
        {pasteNote && <div className="note warn small mt">Pasted text is noted in your report. Answers in your own words are best.</div>}
        {error && <div className="note bad mt" role="alert">{error}</div>}
      </div>

      <div className="interview-foot row">
        <button
          className="btn" disabled={thinking}
          onClick={() => confirm('End the interview here? Everything you have answered so far will still be scored.') && finish('candidate_ended')}
        >
          End interview
        </button>
        <div style={{ flex: 1 }} />
        {dictation.supported && (
          <button
            className={`btn ${dictation.listening ? 'danger' : ''}`} disabled={thinking}
            onClick={() => (dictation.listening ? dictation.stop() : (stopSpeaking(), dictation.start()))}
          >
            {dictation.listening ? '■ Stop' : '🎤 Speak'}
          </button>
        )}
        <button className="btn primary lg" onClick={send} disabled={thinking || !answer.trim()}>
          {state.index + 1 >= state.total && !pending ? 'Send and finish' : 'Send answer'}
        </button>
      </div>

      {warning != null && (
        <div className="backdrop">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="warn-title">
            <div className="modal-body">
              <div className="completion-icon warn">!</div>
              <h2 id="warn-title" style={{ textAlign: 'center' }}>Please stay on this tab</h2>
              <p style={{ textAlign: 'center' }} className="muted">
                You left the interview tab. This has been noted in your report.
              </p>
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

function Thanks({ sessionId }) {
  const session = getSession(sessionId)
  const answered = session.turns.filter((t) => t.role === 'candidate').length
  const auto = String(session.end_reason ?? '').startsWith('auto_terminated')

  return (
    <div className="interview-body completion-panel">
      <Steps n={5} />
      <div className={`completion-icon ${auto ? 'warn' : ''}`}>{auto ? '!' : '✓'}</div>
      <div className="interview-eyebrow">{auto ? 'Interview ended' : 'Interview submitted'}</div>
      <h1>{auto ? 'Your interview has ended.' : 'Thank you for your time.'}</h1>
      <p className="muted">
        {auto
          ? 'The interview was ended because the tab was left too many times. Your answers so far have been saved and will be reviewed.'
          : `Your interview is complete${answered ? ` — ${answered} answer${answered === 1 ? '' : 's'} recorded` : ''}.`}
      </p>
      <p className="muted">
        A recruiter will review it and get back to you. You can close this page; there is nothing
        else you need to do.
      </p>
      <p className="small muted mt">If you have not heard back within five working days, contact the recruiter who sent your invite.</p>
    </div>
  )
}
