// The live interviewer (Mode A, §10.3): WebRTC straight to OpenAI Realtime,
// using a 60-second key minted by server/realtime.js. Audio never passes
// through our server.
//
// It writes through the same services as the typed flow — recordLiveTurn and
// liveNextQuestion move the session cursor — so a live interview and a typed
// one produce identical session documents for scoring and the report.

import { getSession, liveNextQuestion, recordLiveTurn, currentQuestion } from '../services/interviews.js'

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'
const MAX_RECONNECTS = 2

/** Is the live interviewer available on this server? */
export async function liveInterviewerAvailable() {
  if (typeof RTCPeerConnection === 'undefined') return false
  try {
    const res = await fetch('/api/realtime/health')
    return res.ok && (await res.json()).configured === true
  } catch {
    return false
  }
}

async function mintKey(session, company) {
  const { plan } = session
  // Only what the prompt needs. Expected points and the rubric stay out.
  const body = {
    company,
    resuming: session.turns.some((t) => t.role === 'candidate'),
    plan: {
      persona: plan.persona,
      rules: plan.rules,
      questions: plan.questions.map((q) => ({ id: q.id })),
      job_context: { title: plan.job_context?.title, reference: plan.job_context?.reference },
      candidate_context: { full_name: plan.candidate_context?.full_name },
    },
  }
  const res = await fetch('/api/realtime/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Could not start the live interviewer (${res.status}).`)
  return data.client_secret
}

export class LiveInterviewer {
  /**
   * @param {object} o
   * @param {string} o.sessionId
   * @param {string} o.company
   * @param {MediaStream} o.mic   the candidate's stream (audio is used)
   * @param {object} o.on        { activity, question, caption, connection, end, fail, error }
   */
  constructor({ sessionId, company, mic, on }) {
    this.sessionId = sessionId
    this.company = company
    this.mic = mic
    this.on = on

    this.audioEl = new Audio()
    this.audioEl.autoplay = true
    this.ctx = new AudioContext()
    const micSource = this.ctx.createMediaStreamSource(mic)
    this.micAnalyser = this.ctx.createAnalyser()
    this.micAnalyser.fftSize = 512
    micSource.connect(this.micAnalyser)
    this.aiAnalyser = null
    // Candidate + interviewer mixed into one track, so the recording has both.
    this.mix = this.ctx.createMediaStreamDestination()
    micSource.connect(this.mix)
    this.levels = new Uint8Array(256)

    this.pc = null
    this.dc = null
    this.questionId = currentQuestion(sessionId).question?.id ?? null
    this.servedThisConnection = false
    this.itemQuestion = new Map()
    this.caption = ''
    this.responseActive = false
    this.queuedResponse = false
    this.ending = null
    this.ended = false
    this.reconnects = 0
  }

  get recordingAudioTrack() {
    return this.mix.stream.getAudioTracks()[0]
  }

  async connect() {
    this.on.activity('connecting')
    await this.ctx.resume()
    const secret = await mintKey(getSession(this.sessionId), this.company)
    if (this.ended) return

    const pc = new RTCPeerConnection()
    this.pc = pc
    this.servedThisConnection = false

    pc.ontrack = (e) => {
      const [remote] = e.streams
      this.audioEl.srcObject = remote
      const src = this.ctx.createMediaStreamSource(remote)
      this.aiAnalyser = this.ctx.createAnalyser()
      this.aiAnalyser.fftSize = 512
      src.connect(this.aiAnalyser)
      src.connect(this.mix)
    }
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc || this.ended) return
      if (pc.connectionState === 'connected') this.on.connection('connected')
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') this.reconnect()
    }
    for (const track of this.mic.getAudioTracks()) pc.addTrack(track, this.mic)

    const dc = pc.createDataChannel('oai-events')
    this.dc = dc
    dc.onmessage = (e) => this.handle(JSON.parse(e.data))
    dc.onopen = () => {
      this.on.connection('connected')
      this.on.activity('thinking')
      this.createResponse() // the interviewer speaks first
    }

    await pc.setLocalDescription(await pc.createOffer())
    const res = await fetch(REALTIME_CALLS_URL, {
      method: 'POST',
      body: pc.localDescription.sdp,
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' },
    })
    if (!res.ok) throw new Error(`Could not connect to the interviewer (${res.status}).`)
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })
  }

  // A dropped connection is rebuilt from storage: the cursor says where we were.
  // Past the limit, the page falls back to the typed interview (§10.7, rung 4).
  async reconnect() {
    if (this.ended || this.ending) return
    this.teardown()
    if (this.reconnects >= MAX_RECONNECTS) {
      this.stop()
      this.on.fail('The live interviewer could not reconnect.')
      return
    }
    this.reconnects += 1
    this.on.connection('reconnecting')
    try {
      await this.connect()
    } catch (err) {
      this.on.error(err.message)
      setTimeout(() => this.reconnect(), 2000)
    }
  }

  // --- levels, for the orb -------------------------------------------------
  level(analyser) {
    if (!analyser) return 0
    analyser.getByteFrequencyData(this.levels)
    let sum = 0
    for (let i = 0; i < analyser.frequencyBinCount; i++) sum += this.levels[i]
    return Math.min(1, (sum / analyser.frequencyBinCount / 255) * 2.5)
  }
  inputLevel = () => this.level(this.micAnalyser)
  outputLevel = () => this.level(this.aiAnalyser)

  // --- candidate controls -----------------------------------------------------
  setMuted(muted) {
    for (const t of this.mic.getAudioTracks()) t.enabled = !muted
  }

  sendTyped(text) {
    const clean = text.trim()
    if (!clean) return
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: clean }] } })
    recordLiveTurn(this.sessionId, { role: 'candidate', text: clean, questionId: this.questionId, typed: true })
    this.createResponse()
  }

  askToRepeat() {
    this.system('The candidate asked you to repeat the current question. Repeat it, more slowly and in simpler words.')
    this.createResponse()
  }

  // §12.5, rule 2: at 80% of the budget, start wrapping up.
  nudgeWrapUp() {
    this.system('About 80% of the interview time has been used. Keep follow-ups to a minimum from now on.')
  }

  nudgeTimeUp() {
    this.system('The interview time is up. Do not ask any more questions. Thank the candidate, give your closing remarks, and call end_interview with reason time_limit.')
    this.createResponse()
  }

  // --- events -----------------------------------------------------------------
  handle(ev) {
    switch (ev.type) {
      case 'response.created':
        this.responseActive = true
        this.on.activity('thinking')
        break
      case 'output_audio_buffer.started':
        this.on.activity('speaking')
        break
      case 'output_audio_buffer.stopped':
        this.on.activity('listening')
        if (this.ending) this.end(this.ending)
        break
      case 'input_audio_buffer.speech_started':
        this.on.activity('listening')
        break
      case 'input_audio_buffer.committed':
        // Attribute the answer to the question being asked when they spoke.
        this.itemQuestion.set(ev.item_id, this.questionId)
        break
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        this.caption += ev.delta
        this.on.caption(this.caption)
        break
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        recordLiveTurn(this.sessionId, {
          role: 'interviewer',
          text: ev.transcript ?? this.caption,
          questionId: this.ending ? null : this.questionId,
        })
        this.caption = ''
        break
      case 'conversation.item.input_audio_transcription.completed': {
        const questionId = this.itemQuestion.has(ev.item_id) ? this.itemQuestion.get(ev.item_id) : this.questionId
        recordLiveTurn(this.sessionId, { role: 'candidate', text: ev.transcript, questionId })
        break
      }
      case 'response.done':
        this.responseActive = false
        this.toolCalls(ev.response?.output ?? [])
        if (this.queuedResponse) {
          this.queuedResponse = false
          this.createResponse()
        }
        break
      case 'error':
        if (ev.error?.code === 'conversation_already_has_active_response') return
        this.on.error(ev.error?.message ?? 'The interviewer reported an error.')
        break
    }
  }

  toolCalls(items) {
    for (const item of items) {
      if (item.type !== 'function_call') continue
      if (item.name === 'next_question') {
        this.toolResult(item.call_id, this.nextQuestion(), true)
      } else if (item.name === 'end_interview') {
        let reason = 'all_questions_answered'
        try { reason = JSON.parse(item.arguments || '{}').reason || reason } catch { /* default */ }
        this.toolResult(item.call_id, { ok: true }, false)
        this.ending = reason
        // Let the goodbye finish playing; the stopped event normally ends it.
        setTimeout(() => this.end(reason), 8000)
      }
    }
  }

  nextQuestion() {
    const state = liveNextQuestion(this.sessionId, { advance: this.servedThisConnection })
    this.servedThisConnection = true
    if (state.done) {
      this.questionId = null
      return { interview_over: true, instruction: 'All questions are done. Close the interview now.' }
    }
    this.questionId = state.question.id
    this.on.question(state)
    const planned = getSession(this.sessionId).plan.questions.find((q) => q.id === state.question.id)
    return {
      question_number: state.index + 1,
      total_questions: state.total,
      question: state.question.text,
      probe_hint: planned?.follow_up_hint ?? null,
    }
  }

  toolResult(callId, output, respond) {
    this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) } })
    if (respond) this.createResponse()
  }

  system(text) {
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } })
  }

  createResponse() {
    if (this.responseActive) {
      this.queuedResponse = true
      return
    }
    this.send({ type: 'response.create' })
  }

  send(event) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(event))
  }

  // --- ending -----------------------------------------------------------------
  end(reason) {
    if (this.ended) return
    this.stop()
    this.on.end(reason)
  }

  /** Stop talking to OpenAI. The page decides what happens next. */
  stop() {
    this.ended = true
    this.teardown()
    this.audioEl.srcObject = null
    this.on.activity('idle')
  }

  teardown() {
    this.dc?.close()
    this.pc?.close()
    this.dc = null
    this.pc = null
    this.responseActive = false
  }

  dispose() {
    this.stop()
    this.ctx.close().catch(() => {})
  }
}
