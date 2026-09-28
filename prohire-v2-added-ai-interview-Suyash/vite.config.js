import react from '@vitejs/plugin-react'
import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import { realtimeApi } from './server/realtime.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' loads every variable in .env, not only VITE_*. None of them reach the
  // browser bundle: only the server plugin reads them.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      // The live AI interviewer (OpenAI Realtime). Without OPENAI_API_KEY the
      // app still runs; interviews use the built-in browser voice instead.
      realtimeApi({
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
        transcribeModel: env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
      }),
    ],
  }
})
