// The whole database. It lives in localStorage.
//
// The system design calls for MongoDB; this prototype keeps the same shapes —
// collections of documents, denormalised names on applications, an atomic
// counter for job references — but the storage engine is a JSON blob in the
// browser. Every service in src/services talks to this module and nothing else,
// so swapping it for a real API later is one file's worth of work.

const KEY = 'prohire.v2'
const SCHEMA_VERSION = 1

const EMPTY = {
  schema_version: SCHEMA_VERSION,
  recruiters: [],
  settings: [],
  counters: [],
  departments: [],
  jobs: [],
  candidates: [],
  applications: [],
  interview_templates: [],
  interview_sessions: [],
  interview_reports: [],
  activity: [],
}

const COLLECTIONS = Object.keys(EMPTY).filter((k) => Array.isArray(EMPTY[k]))

// One cache and one listener set per page, even if this module is evaluated
// twice (Vite hot reload). Two copies would each hold their own snapshot, and
// the staler one would overwrite the newer one on its next write.
const shared = (globalThis.__prohireDb ??= { cache: null, listeners: new Set() })
const listeners = shared.listeners
let cache = shared.cache

// Another tab wrote — typically the candidate's interview tab while the
// recruiter console is open. Drop our copy so the next read is fresh;
// otherwise this tab's next write would silently erase theirs.
if (typeof window !== 'undefined' && !shared.watching) {
  shared.watching = true
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    cache = shared.cache = null
    listeners.forEach((fn) => fn())
  })
}

function read() {
  if (shared.cache !== cache) cache = shared.cache
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      cache = shared.cache = structuredClone(EMPTY)
    } else {
      const parsed = JSON.parse(raw)
      // Forward-compatible: a collection added after a user's data was written
      // shows up empty rather than undefined.
      cache = shared.cache = { ...structuredClone(EMPTY), ...parsed }
    }
  } catch {
    cache = shared.cache = structuredClone(EMPTY)
  }
  return cache
}

function flush() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch (err) {
    // QuotaExceeded is the realistic failure here — resume text and recordings
    // add up. Surface it rather than silently losing the write.
    console.error('ProHire: could not persist to localStorage', err)
    throw new Error(
      'Local storage is full. Export or reset your data from Settings.',
    )
  }
  listeners.forEach((fn) => fn())
}

/** Subscribe to every write. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function matches(doc, query) {
  return Object.entries(query).every(([k, want]) => {
    const got = k.includes('.')
      ? k.split('.').reduce((o, part) => (o == null ? o : o[part]), doc)
      : doc[k]
    if (Array.isArray(want)) return want.includes(got)
    return got === want
  })
}

export const db = {
  /** Every document in a collection, newest first by created_at when present. */
  all(collection) {
    return structuredClone(read()[collection] ?? [])
  },

  find(collection, query = {}) {
    return this.all(collection).filter((d) => matches(d, query))
  },

  findOne(collection, query = {}) {
    const q = typeof query === 'string' ? { _id: query } : query
    return this.find(collection, q)[0] ?? null
  },

  insert(collection, doc) {
    read()[collection].push(structuredClone(doc))
    flush()
    return structuredClone(doc)
  },

  /** Shallow-merges `patch` into the matching document. */
  update(collection, id, patch) {
    const list = read()[collection]
    const i = list.findIndex((d) => d._id === id)
    if (i === -1) throw new Error(`${collection}/${id} not found`)
    list[i] = { ...list[i], ...structuredClone(patch), updated_at: new Date().toISOString() }
    flush()
    return structuredClone(list[i])
  },

  /** Replaces the document wholesale. Used when a patch would be a lie. */
  replace(collection, id, doc) {
    const list = read()[collection]
    const i = list.findIndex((d) => d._id === id)
    if (i === -1) throw new Error(`${collection}/${id} not found`)
    list[i] = structuredClone(doc)
    flush()
    return structuredClone(doc)
  },

  remove(collection, id) {
    const list = read()[collection]
    const i = list.findIndex((d) => d._id === id)
    if (i === -1) return false
    list.splice(i, 1)
    flush()
    return true
  },

  /**
   * The job-reference counter. In MongoDB this is findOneAndUpdate with $inc,
   * which is atomic. A browser tab is single-threaded, so this genuinely is.
   */
  nextSeq(name) {
    const counters = read().counters
    let c = counters.find((x) => x._id === name)
    if (!c) {
      c = { _id: name, seq: 0 }
      counters.push(c)
    }
    c.seq += 1
    flush()
    return c.seq
  },

  /** Whole-database export, for the Settings screen. */
  dump() {
    return structuredClone(read())
  },

  load(data) {
    cache = shared.cache = { ...structuredClone(EMPTY), ...data }
    flush()
  },

  reset() {
    cache = shared.cache = structuredClone(EMPTY)
    flush()
  },

  stats() {
    const d = read()
    return COLLECTIONS.map((c) => ({ collection: c, count: d[c].length }))
  },

  /** Approximate bytes used, for the storage meter in Settings. */
  bytes() {
    try {
      return new Blob([localStorage.getItem(KEY) ?? '']).size
    } catch {
      return 0
    }
  },
}
