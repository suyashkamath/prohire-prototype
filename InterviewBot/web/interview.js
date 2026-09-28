// The candidate's interview page.
//
// welcome + consent → camera & mic check → live interview with the Sarvam agent → done.
// Audio goes to OUR server over a WebSocket (never straight to Sarvam, never with a key).
// The camera video is recorded here, with both voices mixed in, and uploaded at the end.

const $ = (id) => document.getElementById(id)
const sessionId = location.pathname.split('/').pop()

const TEXT = {
  English: {
    hello: (n) => `Hello, ${n}.`,
    lead: (job, co, mins, ai) => `You're invited to an interview for ${job} at ${co}. It takes about ${mins} minutes. You'll speak with ${ai}, an AI interviewer. A recruiter reviews everything and makes the decision.`,
    consent: ['Your video and voice are recorded, with a transcript of the conversation.', 'It is shared only with the recruiting team for this job.', 'Leaving this tab is noted.', 'It is kept for 180 days, then deleted (DPDP Act).', 'The AI does not decide. A person does.'],
    agree: 'I understand and agree to this interview being recorded.',
    toCheck: 'Continue', checkTitle: 'Camera and microphone', checkText: 'Your browser will ask for permission. Sit somewhere quiet and stay on this tab.',
    enable: 'Turn on camera and microphone', begin: 'Start interview', denied: 'Permission was denied. Allow camera and microphone in the address bar, then try again.',
    connecting: 'Connecting…', listening: 'Listening…', speaking: 'Speaking…', youSpeaking: 'You are speaking…',
    end: 'End interview', confirmEnd: 'End the interview now? Your answers so far are kept.',
    warn: (n, m) => `You left the interview tab (${n} of ${m}). Please stay on this tab — after ${m} warnings the interview ends.`,
    you: 'You', saving: 'Saving your interview…', doneTitle: 'Thank you for your time.', doneText: 'Your interview is complete. A recruiter will review it and get back to you. You can close this page.',
    endedTabs: 'The interview ended because the tab was left too many times. Your answers so far are saved.',
    lost: 'The connection was lost.',
  },
  Hindi: {
    hello: (n) => `नमस्ते, ${n}।`,
    lead: (job, co, mins, ai) => `आपको ${co} में ${job} पद के interview के लिए बुलाया गया है। इसमें लगभग ${mins} मिनट लगेंगे। आपकी बात ${ai} से होगी, जो एक AI interviewer है। सब कुछ एक recruiter देखते हैं और फ़ैसला वही लेते हैं।`,
    consent: ['आपका video और आवाज़ record होंगे, साथ में बातचीत का transcript भी।', 'यह सिर्फ़ इस job की recruiting team के साथ share होगा।', 'Tab छोड़ना दर्ज होता है।', 'यह 180 दिन रखा जाएगा, फिर delete (DPDP Act)।', 'फ़ैसला AI नहीं, एक इंसान लेता है।'],
    agree: 'मैं समझता/समझती हूँ और इस interview के record होने के लिए सहमत हूँ।',
    toCheck: 'आगे बढ़ें', checkTitle: 'Camera और microphone', checkText: 'आपका browser permission माँगेगा। किसी शांत जगह बैठें और इसी tab पर रहें।',
    enable: 'Camera और microphone चालू करें', begin: 'Interview शुरू करें', denied: 'Permission नहीं मिली। Address bar में camera और microphone की अनुमति दें, फिर दोबारा कोशिश करें।',
    connecting: 'जुड़ रहा है…', listening: 'सुन रही है…', speaking: 'बोल रही है…', youSpeaking: 'आप बोल रहे हैं…',
    end: 'Interview ख़त्म करें', confirmEnd: 'क्या interview अभी ख़त्म करना है? अब तक के जवाब सुरक्षित रहेंगे।',
    warn: (n, m) => `आपने interview का tab छोड़ा (${n} / ${m})। कृपया इसी tab पर रहें — ${m} warnings के बाद interview ख़त्म हो जाएगा।`,
    you: 'आप', saving: 'आपका interview save हो रहा है…', doneTitle: 'आपके समय के लिए धन्यवाद।', doneText: 'आपका interview पूरा हो गया। एक recruiter इसे देखकर आपसे संपर्क करेंगे। आप यह page बंद कर सकते हैं।',
    endedTabs: 'Tab बार-बार छोड़ने की वजह से interview ख़त्म कर दिया गया। अब तक के जवाब save हैं।',
    lost: 'Connection टूट गया।',
  },
}

let info, t, stream, ctx, ws, recorder, chunks = [], mixDest
let playing = [], nextAt = 0, startedAt = 0, timerId, ended = false

const show = (id) => ['welcome', 'check', 'live', 'done'].forEach((s) => { $(s).hidden = s !== id })
const setState = (text, orb = '') => { $('state').textContent = text; $('orb').className = `orb ${orb}` }
const error = (msg) => { $('error').innerHTML = msg ? `<div class="note bad">${msg}</div>` : '' }

async function init() {
  const res = await fetch(`/api/sessions/${sessionId}/public`)
  if (!res.ok) return error('This interview link is not valid.')
  info = await res.json()
  t = TEXT[info.language] ?? TEXT.English
  document.documentElement.lang = info.language === 'Hindi' ? 'hi' : 'en'
  $('title').textContent = info.job_title
  $('subtitle').textContent = `${info.company} · ${info.interviewer_name} · ${info.language}`
  if (info.status === 'ended') { show('done'); $('doneTitle').textContent = t.doneTitle; $('doneText').textContent = t.doneText; return }

  $('helloText').textContent = t.hello(info.candidate_name.split(' ')[0])
  $('leadText').textContent = t.lead(info.job_title, info.company, info.duration_minutes, info.interviewer_name)
  $('consentList').innerHTML = t.consent.map((c) => `<li>${c}</li>`).join('')
  $('agreeText').textContent = t.agree
  $('toCheck').textContent = t.toCheck
  $('agree').onchange = () => { $('toCheck').disabled = !$('agree').checked }
  $('toCheck').onclick = () => {
    show('check')
    $('checkTitle').textContent = t.checkTitle
    $('checkText').textContent = t.checkText
    $('enable').textContent = t.enable
    $('begin').textContent = t.begin
  }
  $('enable').onclick = enableDevices
  $('begin').onclick = begin
  $('endBtn').textContent = t.end
  $('endBtn').onclick = () => { if (confirm(t.confirmEnd)) send({ type: 'end' }) }
  $('interviewerName').textContent = info.interviewer_name
  show('welcome')
}

async function enableDevices() {
  $('checkError').innerHTML = ''
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    $('preview').srcObject = stream
    $('begin').disabled = false
  } catch (e) {
    $('checkError').innerHTML = `<div class="note bad small">${e.name === 'NotAllowedError' ? t.denied : e.message}</div>`
  }
}

// --- audio in: mic → 16 kHz PCM → server ---------------------------------------

function toBase64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function startAudio() {
  ctx = new AudioContext()
  await ctx.audioWorklet.addModule('/static/pcm-worklet.js')
  const mic = ctx.createMediaStreamSource(stream)
  const capture = new AudioWorkletNode(ctx, 'pcm-capture')
  capture.port.onmessage = (e) => send({ type: 'audio', audio: toBase64(e.data) })
  const silent = ctx.createGain()
  silent.gain.value = 0
  mic.connect(capture).connect(silent).connect(ctx.destination)
  // The recording gets both voices: the candidate's mic and the interviewer.
  mixDest = ctx.createMediaStreamDestination()
  mic.connect(mixDest)
}

// --- audio out: the interviewer's voice ------------------------------------------

async function play(b64, sampleRate) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  let buffer
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    buffer = await ctx.decodeAudioData(bytes.buffer.slice(0))               // a WAV file
  } else {
    const pcm = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1)       // raw 16-bit PCM
    buffer = ctx.createBuffer(1, pcm.length, sampleRate || 16000)
    const ch = buffer.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
  }
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.connect(mixDest)
  nextAt = Math.max(nextAt, ctx.currentTime + 0.02)
  src.start(nextAt)
  nextAt += buffer.duration
  playing.push(src)
  setState(t.speaking, 'speaking')
  src.onended = () => {
    playing = playing.filter((s) => s !== src)
    if (!playing.length && !ended) setState(t.listening, 'listening')
  }
}

function stopPlayback() {
  playing.forEach((s) => { try { s.stop() } catch { /* already stopped */ } })
  playing = []
  nextAt = 0
}

// --- the live interview --------------------------------------------------------------

const send = (msg) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)) }

function addBubble(role, text) {
  const div = document.createElement('div')
  div.className = `bubble ${role}`
  div.innerHTML = `<span class="who"></span>`
  div.querySelector('.who').textContent = role === 'candidate' ? t.you : info.interviewer_name
  div.append(text)
  $('transcript').appendChild(div)
  div.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

async function begin() {
  $('begin').disabled = true
  show('live')
  $('self').srcObject = stream
  setState(t.connecting)
  await startAudio()
  startRecording()

  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/interview/${sessionId}`)
  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'audio') await play(msg.audio, msg.sample_rate)
    else if (msg.type === 'transcript') addBubble(msg.role, msg.text)
    else if (msg.type === 'interrupt') stopPlayback()
    else if (msg.type === 'speech' && msg.state === 'start') setState(t.youSpeaking, 'listening')
    else if (msg.type === 'warning') $('warning').innerHTML = `<div class="note warn small">${t.warn(msg.count, msg.limit)}</div>`
    else if (msg.type === 'error') error(msg.message)
    else if (msg.type === 'status' && msg.state === 'live') { setState(t.listening, 'listening'); startTimer() }
    else if (msg.type === 'status' && msg.state === 'ended') finish(msg.reason)
  }
  ws.onclose = () => { if (!ended) finish('connection_lost') }
}

function startTimer() {
  startedAt = Date.now()
  timerId = setInterval(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000)
    $('timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }, 1000)
}

// Leaving the tab: counted once per departure; the server decides when to end.
let away = false
document.addEventListener('visibilitychange', () => {
  if (!ws || ended) return
  if (document.hidden && !away) { away = true; send({ type: 'event', kind: 'tab_switch' }) }
  if (!document.hidden) away = false
})

// --- recording -----------------------------------------------------------------------

function startRecording() {
  const tracks = [...stream.getVideoTracks(), ...mixDest.stream.getAudioTracks()]
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
  recorder = new MediaRecorder(new MediaStream(tracks), type ? { mimeType: type, videoBitsPerSecond: 600_000 } : undefined)
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  recorder.start(1000)
  $('rec').hidden = false
}

async function uploadRecording() {
  if (!recorder) return
  if (recorder.state !== 'inactive') {
    await new Promise((resolve) => { recorder.onstop = resolve; recorder.stop() })
  }
  if (!chunks.length) return
  const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
  const form = new FormData()
  form.append('file', blob, `interview${blob.type.includes('mp4') ? '.mp4' : '.webm'}`)
  await fetch(`/api/sessions/${sessionId}/recording`, { method: 'POST', body: form })
}

async function finish(reason) {
  if (ended) return
  ended = true
  clearInterval(timerId)
  stopPlayback()
  $('rec').hidden = true
  setState(t.saving)
  try { ws?.close() } catch { /* already closed */ }
  await uploadRecording().catch(() => {})
  stream?.getTracks().forEach((tr) => tr.stop())
  show('done')
  $('doneTitle').textContent = t.doneTitle
  $('doneText').textContent = reason === 'auto_terminated_tab_switches' ? t.endedTabs : reason === 'connection_lost' ? `${t.lost} ${t.doneText}` : t.doneText
}

init().catch((e) => error(e.message))
