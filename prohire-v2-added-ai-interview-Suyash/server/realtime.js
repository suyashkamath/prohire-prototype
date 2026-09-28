// The one piece of server the live interviewer needs (§18.5): mint a
// short-lived OpenAI Realtime credential, so OPENAI_API_KEY never reaches the
// browser. Mounted on the Vite dev and preview servers by vite.config.js.
//
//   GET  /api/realtime/health    → { configured, model }
//   POST /api/realtime/session   → { client_secret, expires_at }
//        body: { plan, company, resuming }
//
// The server builds the instructions itself from the posted plan; a page can
// change the plan's fields but cannot send its own system prompt. In the real
// system the server loads the plan from the session instead of trusting the
// page — this prototype has no server-side session store to load it from.

import { Buffer } from 'node:buffer'

import { buildInterviewerInstructions, DEFAULT_REALTIME_VOICE, INTERVIEWER_TOOLS, REALTIME_VOICES, transcriptionPrompt } from '../src/domain/interviewerPrompt.js'

const MAX_BODY = 200_000

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw Object.assign(new Error('Body is not valid JSON'), { status: 400 })
  }
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function validPlan(plan) {
  return (
    plan && typeof plan === 'object' &&
    plan.persona?.name && plan.rules?.language && Array.isArray(plan.questions) &&
    plan.questions.length > 0 && plan.questions.length <= 30
  )
}

async function mint(config, { plan, company, resuming }) {
  const voice = REALTIME_VOICES.includes(plan.persona.realtime_voice) ? plan.persona.realtime_voice : DEFAULT_REALTIME_VOICE
  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 60 },
      session: {
        type: 'realtime',
        model: config.model,
        instructions: buildInterviewerInstructions({ plan, company: String(company ?? '').slice(0, 200), resuming: Boolean(resuming) }),
        tools: INTERVIEWER_TOOLS,
        tool_choice: 'auto',
        audio: {
          input: {
            transcription: {
              model: config.transcribeModel,
              language: plan.rules.language.split('-')[0],
              prompt: transcriptionPrompt(plan.rules.language),
            },
            noise_reduction: { type: 'near_field' },
            // Candidates pause to think; don't cut them off mid-answer.
            turn_detection: { type: 'semantic_vad', eagerness: 'low' },
          },
          output: { voice },
        },
      },
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw Object.assign(new Error(`OpenAI refused the session (${res.status}): ${detail.slice(0, 400)}`), { status: 502 })
  }
  const data = await res.json()
  // Returned once; never stored or logged.
  return { client_secret: data.value, expires_at: data.expires_at }
}

export function realtimeApi(config) {
  const middleware = async (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    if (!url.startsWith('/api/realtime/')) return next()
    try {
      if (req.method === 'GET' && url === '/api/realtime/health') {
        return send(res, 200, { configured: Boolean(config.apiKey), model: config.model })
      }
      if (req.method === 'POST' && url === '/api/realtime/session') {
        if (!config.apiKey) return send(res, 503, { error: 'OPENAI_API_KEY is not set on the server.' })
        const body = await readJson(req)
        if (!validPlan(body.plan)) return send(res, 422, { error: 'A valid interview plan is required.' })
        return send(res, 200, await mint(config, body))
      }
      send(res, 404, { error: 'Not found' })
    } catch (err) {
      const status = err.status ?? 500
      if (status >= 500) console.error('[realtime]', err.message)
      send(res, status, { error: err.message })
    }
  }

  return {
    name: 'prohire-realtime-api',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  }
}
