import { useEffect, useState } from 'react'

import { loadRecording, extensionFor } from '../lib/media.js'
import { downloadBlob } from '../lib/csv.js'

/**
 * The interview recording, with a download button — the thing the vendor
 * portal would not give us.
 *
 * `videoRef` is owned by the caller so the question list can seek the video
 * to the moment each question was asked.
 */
export default function RecordingPlayer({ session, videoRef, filename, allowDownload = true }) {
  const segments = session.recording?.segments ?? 0
  const [urls, setUrls] = useState(null)

  useEffect(() => {
    if (!segments) return
    let cancelled = false
    const made = []
    ;(async () => {
      const out = []
      for (let i = 1; i <= segments; i++) {
        const key = i === 1 ? session._id : `${session._id}:${i}`
        const blob = await loadRecording(key)
        if (blob) {
          const url = URL.createObjectURL(blob)
          made.push(url)
          out.push({ key, url, blob, segment: i })
        }
      }
      if (!cancelled) setUrls(out)
    })()
    return () => {
      cancelled = true
      made.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [session._id, segments])

  // An AI voice call is recorded by the InterviewBot server, and played from there.
  if (session.recording?.url) {
    return (
      <div className="col" style={{ gap: 10 }}>
        <video ref={videoRef} src={session.recording.url} controls playsInline className="recording-video" />
        {allowDownload && (
          <div className="row">
            <a className="btn sm" href={session.recording.url} download={`${filename}.webm`}>⬇ Download video</a>
          </div>
        )}
      </div>
    )
  }

  if (!segments) {
    return (
      <div className="recording-empty">
        {session.device?.camera === false || session.device?.microphone === false
          ? 'The candidate continued without camera or microphone — there is no recording.'
          : session.plan.rules.mode === 'text'
            ? 'Typed interview — no recording.'
            : 'No recording was captured.'}
      </div>
    )
  }
  if (urls == null) return <div className="recording-empty"><span className="spin" /> Loading recording…</div>
  if (urls.length === 0) {
    return (
      <div className="recording-empty">
        The recording was made on another device or browser. In this prototype recordings stay in the
        browser that captured them; the full version stores them on the server.
      </div>
    )
  }

  const isAudio = session.plan.rules.mode === 'voice'
  return (
    <div className="col" style={{ gap: 10 }}>
      {urls.map((u, i) => (
        <div key={u.key}>
          {urls.length > 1 && <div className="small muted mb">Part {u.segment} (the candidate reconnected)</div>}
          {isAudio
            ? <audio ref={i === 0 ? videoRef : undefined} src={u.url} controls style={{ width: '100%' }} />
            : <video ref={i === 0 ? videoRef : undefined} src={u.url} controls playsInline className="recording-video" />}
          {allowDownload && (
            <div className="row mt">
              <button
                className="btn sm"
                onClick={() => downloadBlob(`${filename}${urls.length > 1 ? `-part${u.segment}` : ''}.${extensionFor(u.blob.type)}`, u.blob)}
              >
                ⬇ Download {isAudio ? 'audio' : 'video'} ({(u.blob.size / 1024 / 1024).toFixed(1)} MB)
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
