// Interview recordings.
//
// Video is far too large for localStorage (5 MB for the whole database), so
// recordings go to IndexedDB, keyed by session id. Same caveat as everything
// else in the prototype: it lives in this browser only. In the real system the
// recorder streams chunks to object storage and the report links to that.

const DB_NAME = 'prohire.v2.media'
const STORE = 'recordings'

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available.'))
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx(mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const out = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(out?.result ?? out)
    t.onerror = () => reject(t.error)
  })
}

export function saveRecording(sessionId, blob) {
  return tx('readwrite', (s) => s.put(blob, sessionId))
}

export async function loadRecording(sessionId) {
  try {
    const db = await open()
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(sessionId)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export function deleteRecording(sessionId) {
  return tx('readwrite', (s) => s.delete(sessionId)).catch(() => {})
}

/** Pick a container the browser can actually record. Safari only does mp4. */
export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  const options = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
  return options.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? ''
}

export const extensionFor = (mime = '') => (mime.includes('mp4') ? 'mp4' : 'webm')
