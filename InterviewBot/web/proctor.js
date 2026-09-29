// Fairness checks on the candidate's camera, run in their own browser.
//
// About six times a second MediaPipe's face landmarker looks at the camera
// picture, and once a second an object detector counts the people in it and
// looks for a phone. This file notes:
//   · no face                                          → no_face
//   · more than one person (the face landmarker misses a smaller face in the
//     background; the person detector does not)        → multiple_faces
//   · a phone held or lying in view                    → phone_visible
//   · head or eyes turned well away from the screen    → looking_away
//   · a voice on the microphone while the lips are still → voice_without_lips
//   · per answer: how much of it was spent looking away, and eye movement
//     like reading (sweep along a line, jump back, again and again)
// Only these numbers leave the browser — never a picture, never face data.
// Short moments are ignored (see MIN_SECONDS): people look away to think.
//
// If the model cannot load (old browser, blocked network) the interview goes on
// and the report says the camera check was unavailable.

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1'
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const OBJECTS = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite'
const EVERY_MS = 160                     // ~6 checks a second
const OBJECTS_EVERY = 6                  // the (slower) person/phone check: every 6th check, ~once a second
const OBJECTS_FRESH_MS = 1600            // how long its answer counts for
const MIN_SECONDS = { multiple_faces: 1.5, no_face: 5, looking_away: 5, voice_without_lips: 3, phone_visible: 2 }
const GAP = 1.0                          // a condition must be gone this long before an episode ends
const BASELINE_SAMPLES = 30              // the first ~5 s with a face: how this candidate looks at the screen
const AWAY = { yaw: 30, pitch: 25, gaze: 0.4, down: 0.4 }   // how far from the baseline counts as away
const VIRTUAL_CAMERA = /virtual|obs|manycam|xsplit|snap camera|splitcam|vcam/i

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const deg = (r) => (r * 180) / Math.PI
const clamp1 = (x) => Math.max(-1, Math.min(1, x))

// Start downloading the models early (on the camera check page): ~20 MB in all.
let loading = null
export function preload() {
  loading ??= loadModels()
  loading.catch(() => {})
  return loading
}

// CPU, not GPU: on some machines the GPU path runs without an error yet finds
// no face at all, which would read as "candidate out of view" all interview.
async function loadModels() {
  const { FaceLandmarker, ObjectDetector, FilesetResolver } = await import(`${VISION}/vision_bundle.mjs`)
  const files = await FilesetResolver.forVisionTasks(`${VISION}/wasm`)
  const [faces, objects] = await Promise.all([
    FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
      runningMode: 'VIDEO', numFaces: 3,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    }),
    // Optional: without it, people are counted from faces only.
    ObjectDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: OBJECTS, delegate: 'CPU' },
      runningMode: 'VIDEO', scoreThreshold: 0.5, categoryAllowlist: ['person', 'cell phone'],
    }).catch(() => null),
  ])
  return { faces, objects }
}

// Head turn (yaw) and nod (pitch) from the face's transformation matrix, in degrees.
function headPose(matrix) {
  const d = matrix?.data
  if (!d || d.length < 16) return null
  // Row- or column-major, the sign may flip; only the change from the baseline is used.
  return { yaw: deg(Math.asin(clamp1((d[8] - d[2]) / 2))), pitch: deg(Math.atan2(d[6], d[10])) }
}

// Where the eyes point, from the blendshapes: h (left/right) and down, about -1…1.
function gaze(categories) {
  const b = Object.fromEntries((categories ?? []).map((c) => [c.categoryName, c.score]))
  return {
    h: ((b.eyeLookOutLeft ?? 0) - (b.eyeLookInLeft ?? 0) + (b.eyeLookInRight ?? 0) - (b.eyeLookOutRight ?? 0)) / 2,
    down: ((b.eyeLookDownLeft ?? 0) + (b.eyeLookDownRight ?? 0) - (b.eyeLookUpLeft ?? 0) - (b.eyeLookUpRight ?? 0)) / 2,
    jaw: b.jawOpen ?? 0,
  }
}

const faceSize = (landmarks) => {
  const xs = landmarks.map((p) => p.x), ys = landmarks.map((p) => p.y)
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
}

// Reading: the eyes drift steadily one way along a line, then jump back — again and again.
export function countSweeps(hs) {
  let best = 0
  for (const dir of [1, -1]) {
    let run = 0, rise = 0, sweeps = 0
    for (let i = 1; i < hs.length; i++) {
      const step = (hs[i] - hs[i - 1]) * dir
      if (step > 0.005) { run++; rise += step }
      else if (step < -0.2 && run >= 3 && rise > 0.15) { sweeps++; run = 0; rise = 0 }
      else if (step < -0.02) { run = 0; rise = 0 }
    }
    best = Math.max(best, sweeps)
  }
  return best
}

export async function startProctor({ video, stream, audioCtx, isInterviewerSpeaking, onEpisode, onWarn }) {
  const cameraLabel = stream.getVideoTracks()[0]?.label ?? ''
  const summary = {
    face_check: 'on', reason: null, samples: 0, face_visible_share: null,
    totals: { multiple_faces: 0, no_face: 0, looking_away: 0, voice_without_lips: 0, phone_visible: 0 },
    people_check: 'faces only',         // 'faces and people' when the person detector loaded
    multi_share: null,                  // share of checks with 2+ people: near 1 = likely a photo or poster
    episodes: [],                       // every episode, also sent live as it ends
    answers: [],
    screen_extended: window.screen?.isExtended ?? null,
    virtual_camera: VIRTUAL_CAMERA.test(cameraLabel) ? cameraLabel : null,
    camera_label: cameraLabel,
  }
  let landmarker, objects
  try {
    ({ faces: landmarker, objects } = await preload())
    if (objects) summary.people_check = 'faces and people'
  } catch (e) {
    summary.face_check = 'unavailable'
    summary.reason = String(e?.message ?? e).slice(0, 160)
  }

  // Microphone loudness, to tell when someone is speaking.
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 1024
  audioCtx.createMediaStreamSource(stream).connect(analyser)
  const wave = new Float32Array(analyser.fftSize)
  let noise = 0.01
  const loudness = () => {
    analyser.getFloatTimeDomainData(wave)
    let sum = 0
    for (const x of wave) sum += x * x
    return Math.sqrt(sum / wave.length)
  }

  const t0 = performance.now()
  const now = () => (performance.now() - t0) / 1000
  const open = {}                       // kind → { from, last }
  const base = { yaw: [], pitch: [], h: [], down: [] }
  let baseline = null, withFace = 0, lastWarned = -999
  let ticks = 0, people = { count: 0, phone: false, at: -1e9 }, multiSamples = 0
  const jaws = []
  let answer = null                     // the answer being given: { from_s, samples, away, hs }

  function episode(kind, on, t) {
    const e = open[kind]
    if (on) {
      if (!e) open[kind] = { from: t, last: t }
      else e.last = t
      if (kind === 'multiple_faces' && t - open[kind].from >= MIN_SECONDS[kind] && t - lastWarned > 60) {
        lastWarned = t
        onWarn?.('multiple_faces')
      }
    } else if (e && t - e.last >= GAP) {
      close(kind)
    }
  }
  function close(kind) {
    const e = open[kind]
    delete open[kind]
    const seconds = e.last - e.from
    if (seconds < MIN_SECONDS[kind]) return
    summary.totals[kind] = Math.round((summary.totals[kind] + seconds) * 10) / 10
    const detail = { from_s: Math.round(e.from * 10) / 10, seconds: Math.round(seconds * 10) / 10 }
    summary.episodes.push({ kind, ...detail })
    onEpisode?.(kind, detail)
  }

  function check() {
    if (!landmarker || video.readyState < 2) return
    const t = now()
    let result
    try { result = landmarker.detectForVideo(video, performance.now()) } catch { return }
    summary.samples++
    const faces = result.faceLandmarks?.length ?? 0

    // People and phones, about once a second.
    if (objects && ticks++ % OBJECTS_EVERY === 0) {
      try {
        const found = objects.detectForVideo(video, performance.now()).detections.map((d) => d.categories[0]?.categoryName)
        people = { count: found.filter((n) => n === 'person').length, phone: found.includes('cell phone'), at: performance.now() }
      } catch { /* one missed check is fine */ }
    }
    const fresh = performance.now() - people.at < OBJECTS_FRESH_MS
    const crowd = Math.max(faces, fresh ? people.count : 0)
    if (crowd >= 2) multiSamples++

    // Mic: speaking = well above the room's own level, and not the interviewer's voice.
    const level = loudness()
    const speaking = level > Math.max(0.02, noise * 3) && !isInterviewerSpeaking()
    if (!speaking) noise = 0.95 * noise + 0.05 * level

    episode('no_face', faces === 0, t)
    episode('multiple_faces', crowd >= 2, t)
    episode('phone_visible', fresh && people.phone, t)
    if (!faces) { episode('looking_away', false, t); episode('voice_without_lips', false, t); return }
    withFace++

    // The candidate is the biggest face on camera.
    let i = 0
    if (faces > 1) result.faceLandmarks.forEach((f, k) => { if (faceSize(f) > faceSize(result.faceLandmarks[i])) i = k })
    const pose = headPose(result.facialTransformationMatrixes?.[i])
    const g = gaze(result.faceBlendshapes?.[i]?.categories)

    if (!baseline) {
      if (pose) { base.yaw.push(pose.yaw); base.pitch.push(pose.pitch) }
      base.h.push(g.h); base.down.push(g.down)
      if (base.h.length >= BASELINE_SAMPLES) {
        baseline = { yaw: median(base.yaw), pitch: median(base.pitch), h: median(base.h), down: median(base.down) }
      }
      return
    }
    const away = (pose && (Math.abs(pose.yaw - baseline.yaw) > AWAY.yaw || Math.abs(pose.pitch - baseline.pitch) > AWAY.pitch))
      || Math.abs(g.h - baseline.h) > AWAY.gaze || g.down - baseline.down > AWAY.down
    episode('looking_away', away, t)

    // Lips: moving if the jaw opens and closes, or is open.
    jaws.push(g.jaw)
    if (jaws.length > 6) jaws.shift()
    const mean = jaws.reduce((a, b) => a + b, 0) / jaws.length
    const spread = Math.sqrt(jaws.reduce((a, b) => a + (b - mean) ** 2, 0) / jaws.length)
    const lipsMoving = spread > 0.025 || mean > 0.12
    episode('voice_without_lips', speaking && jaws.length === 6 && !lipsMoving, t)

    if (answer) {
      answer.samples++
      if (away) answer.away++
      answer.hs.push(g.h)
    }
  }

  const timer = setInterval(check, EVERY_MS)

  return {
    answerStarted() {
      answer = { from_s: now(), samples: 0, away: 0, hs: [] }
    },
    answerEnded() {
      if (!answer) return
      const a = answer
      answer = null
      const seconds = now() - a.from_s
      if (!a.samples || seconds < 3) return
      const sweeps = countSweeps(a.hs)
      const perMin = sweeps / (seconds / 60)
      summary.answers.push({
        from_s: Math.round(a.from_s * 10) / 10,
        seconds: Math.round(seconds * 10) / 10,
        away_share: Math.round((a.away / a.samples) * 100) / 100,
        sweeps,
        reading_like: seconds >= 20 && sweeps >= 4 && perMin >= 6,
      })
    },
    stop() {
      clearInterval(timer)
      this.answerEnded()
      for (const kind of Object.keys(open)) close(kind)
      summary.face_visible_share = summary.samples ? Math.round((withFace / summary.samples) * 100) / 100 : null
      summary.multi_share = summary.samples ? Math.round((multiSamples / summary.samples) * 100) / 100 : null
      try { landmarker?.close(); objects?.close() } catch { /* already closed */ }
      return summary
    },
  }
}
