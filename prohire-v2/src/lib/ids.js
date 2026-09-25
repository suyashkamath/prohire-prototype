// Ids and tokens.
//
// Mongo hands out ObjectIds; here we make something with the same properties
// that matter — unique, sortable by creation time, short enough to read in a
// URL.

const ALPHABET = '0123456789abcdef'

function rand(n) {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALPHABET[b & 15] + ALPHABET[b >> 4]).join('')
}

/** 24 hex chars, time-prefixed. Shaped like an ObjectId on purpose. */
export function newId() {
  const ts = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0')
  return ts + rand(8)
}

/**
 * An invite token. The design stores only sha256(token) server-side and mails
 * the raw value; in a browser-only prototype there is no server to keep a
 * secret from, so the token is stored as-is and the hashing step is noted
 * rather than faked.
 */
export function newToken() {
  return rand(16)
}

export const nowIso = () => new Date().toISOString()

/** A short, readable id for a question a human just typed. */
export function newQuestionId(prefix = 'q') {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}
