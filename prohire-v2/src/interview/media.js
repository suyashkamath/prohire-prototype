// Browser media for the candidate surface: the camera recorder, spoken
// questions (text-to-speech) and spoken answers (speech-to-text).
//
// All three degrade rather than fail. No camera → the interview runs without
// video and the report says so. No speech engine for Tamil in this browser →
// the question is shown on screen and the candidate types. The candidate is
// never blocked by a missing browser feature.

import { useEffect, useRef, useState } from 'react'
import { saveRecording, pickMimeType } from '../lib/media.js'
import { setRecordingMeta } from '../services/interviews.js'

// --- text to speech ---------------------------------------------------------

/**
 * The best voice for a language. Exact Indian locale first (en-IN gives an
 * Indian-English accent, not an American one), then any voice for the base
 * language, then nothing — in which case we do not speak rather than read
 * Hindi in an American English voice.
 */
export function pickVoice(lang) {
  if (typeof speechSynthesis === 'undefined') return null
  const voices = speechSynthesis.getVoices()
  const norm = (l) => l.replace('_', '-').toLowerCase()
  const want = norm(lang)
  const base = want.split('-')[0]
  const exact = voices.filter((v) => norm(v.lang) === want)
  // Prefer the natural/neural voices browsers ship when they have them.
  const nice = exact.find((v) => /natural|neural|google|premium|enhanced/i.test(v.name))
  return nice ?? exact[0] ?? voices.find((v) => norm(v.lang).startsWith(base + '-')) ?? null
}

export function canSpeak(lang) {
  return typeof speechSynthesis !== 'undefined' && Boolean(pickVoice(lang))
}

/** Voices load asynchronously in Chrome; this re-renders once they arrive. */
export function useVoicesReady() {
  const [ready, setReady] = useState(() => typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices().length > 0)
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return
    const on = () => setReady(true)
    speechSynthesis.addEventListener?.('voiceschanged', on)
    return () => speechSynthesis.removeEventListener?.('voiceschanged', on)
  }, [])
  return ready
}

export function speak(text, lang, { onStart, onEnd } = {}) {
  if (typeof speechSynthesis === 'undefined' || !text) return onEnd?.()
  const voice = pickVoice(lang)
  if (!voice) return onEnd?.()
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.voice = voice
  u.lang = voice.lang
  // A touch slower than default: an interview question heard once should be
  // understood once.
  u.rate = 0.95
  u.onstart = () => onStart?.()
  u.onend = () => onEnd?.()
  u.onerror = () => onEnd?.()
  speechSynthesis.speak(u)
}

export function stopSpeaking() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

// --- speech to text ---------------------------------------------------------

const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition ?? window.webkitSpeechRecognition) : null
export const canListen = () => Boolean(Recognition)

/**
 * Dictation into the answer box. Final phrases are appended; the interim
 * phrase is shown live. The candidate can always edit what was heard.
 */
export function useDictation(lang, onFinal) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recRef = useRef(null)
  const finalRef = useRef(onFinal)
  useEffect(() => { finalRef.current = onFinal }, [onFinal])

  useEffect(() => () => recRef.current?.abort?.(), [])

  function start() {
    if (!Recognition || listening) return
    const rec = new Recognition()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalRef.current?.(r[0].transcript.trim())
        else live += r[0].transcript
      }
      setInterim(live)
    }
    rec.onend = () => { setListening(false); setInterim('') }
    rec.onerror = () => { setListening(false); setInterim('') }
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  function stop() {
    recRef.current?.stop()
  }

  return { listening, interim, start, stop, supported: Boolean(Recognition) }
}

// --- camera -----------------------------------------------------------------

export async function requestCamera({ video = true } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use a camera.')
  return navigator.mediaDevices.getUserMedia({
    video: video ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false,
    audio: { echoCancellation: true, noiseSuppression: true },
  })
}

export function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop())
}

/**
 * Record the stream for the whole session.
 *
 * The recording is re-saved to IndexedDB every ten seconds, so a crashed tab
 * loses ten seconds of video, not the interview. A resumed session records a
 * new segment rather than trying to splice video files together.
 */
export function useRecorder(sessionId, stream, existingSegments = 0) {
  const recRef = useRef(null)
  const chunks = useRef([])
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!stream || typeof MediaRecorder === 'undefined') return
    const mime = pickMimeType()
    let rec
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 600_000 } : undefined)
    } catch {
      return
    }
    const segment = existingSegments + 1
    const key = segment === 1 ? sessionId : `${sessionId}:${segment}`
    const startedAt = new Date().toISOString()
    chunks.current = []

    const persist = async () => {
      if (!chunks.current.length) return
      const blob = new Blob(chunks.current, { type: rec.mimeType || mime || 'video/webm' })
      try {
        await saveRecording(key, blob)
        const meta = {
          available: true,
          mime: blob.type,
          segments: segment,
          [`segment_${segment}`]: { key, started_at: startedAt, bytes: blob.size },
        }
        if (segment === 1) meta.started_at = startedAt
        setRecordingMeta(sessionId, meta)
      } catch {
        // Storage full or blocked — the interview carries on without video.
      }
    }

    rec.ondataavailable = (e) => { if (e.data?.size) chunks.current.push(e.data) }
    rec.onstop = persist
    rec.start(1000)
    recRef.current = rec
    setRecording(true)
    const t = setInterval(persist, 10_000)

    return () => {
      clearInterval(t)
      if (rec.state !== 'inactive') rec.stop()
      setRecording(false)
    }
    // existingSegments is read once, when recording starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, stream])

  /** Stop and flush. Resolves once the final save has been attempted. */
  function finish() {
    const rec = recRef.current
    if (!rec || rec.state === 'inactive') return Promise.resolve()
    return new Promise((resolve) => {
      const prev = rec.onstop
      rec.onstop = async () => { await prev?.(); resolve() }
      rec.stop()
    })
  }

  return { recording, finish }
}

// --- face presence ------------------------------------------------------------

/**
 * Face checks, where the browser offers a face detector (Chrome with the
 * Shape Detection API). Where it does not, this does nothing and the report
 * says face checks were unavailable — it never guesses.
 */
export function useFacePresence(videoRef, enabled, onEvent) {
  const [supported] = useState(() => typeof window !== 'undefined' && 'FaceDetector' in window)
  const cb = useRef(onEvent)
  useEffect(() => { cb.current = onEvent }, [onEvent])

  useEffect(() => {
    if (!enabled || !supported) return
    let detector
    try {
      detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 })
    } catch {
      return
    }
    let missing = 0
    let crowded = false
    const t = setInterval(async () => {
      const v = videoRef.current
      if (!v || v.readyState < 2) return
      try {
        const faces = await detector.detect(v)
        if (faces.length === 0) {
          // Three checks in a row (~6s), so looking down at notes is not an event.
          if (++missing === 3) cb.current?.('face_missing')
        } else {
          missing = 0
          // Once per appearance of a second face, not once every two seconds.
          if (faces.length > 1 && !crowded) cb.current?.('multiple_faces')
          crowded = faces.length > 1
        }
      } catch {
        // Detector errors on some frames; skip them.
      }
    }, 2000)
    return () => clearInterval(t)
  }, [enabled, supported, videoRef])

  return supported
}
