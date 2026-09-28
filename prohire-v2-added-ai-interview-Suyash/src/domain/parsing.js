// Resume parsing (§13.3).
//
// The real system runs pdfplumber / python-docx / OCR on the server. A browser
// prototype cannot, so text extraction is honest about its limits: .txt and .md
// are read directly, and anything else asks the recruiter to paste the text.
// What happens *after* extraction — field parsing, confidence, versioning — is
// the real thing, because that is the part the UI has to be built against.

import { STATES } from './locations.js'

export const PARSER_VERSION = '2026.09.1-local'

const SKILL_VOCAB = [
  'C#', 'ASP.NET Core', 'ASP.NET', '.NET', 'Entity Framework', 'SQL Server', 'LINQ',
  'JavaScript', 'TypeScript', 'React', 'Redux', 'Next.js', 'Node.js', 'Express',
  'Python', 'Django', 'FastAPI', 'Flask', 'Pandas', 'NumPy',
  'Java', 'Spring Boot', 'Hibernate', 'Kotlin',
  'Go', 'Rust', 'PHP', 'Laravel', 'Ruby', 'Rails',
  'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'Elasticsearch', 'Kafka',
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Jenkins', 'CI/CD',
  'REST', 'GraphQL', 'gRPC', 'Microservices', 'System Design',
  'HTML', 'CSS', 'Tailwind', 'Figma',
  'Salesforce', 'CRM', 'Lead Generation', 'Cold Calling', 'Negotiation',
  'Angular', 'Machine Learning', 'LLM',
  'Excel', 'Tally', 'GST', 'Accounting', 'Payroll', 'Recruitment',
  'Insurance', 'Life Insurance', 'Health Insurance', 'Motor Insurance', 'General Insurance',
  'Agency Channel', 'Bancassurance', 'Channel Sales', 'Field Sales', 'Inside Sales',
  'Key Account Management', 'Customer Service', 'Claims', 'Underwriting',
  'Communication', 'Team Leadership', 'Stakeholder Management',
]

const LANGUAGE_VOCAB = ['English', 'Hindi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Bengali', 'Punjabi']

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/
const PHONE_RE = /(?:\+?91[-\s]?)?[6-9]\d{9}\b/

/** Emails lowercased and trimmed. Gmail dot/plus stripping is deliberately NOT
 *  applied — on a corporate domain those can be two different people (§13.5). */
export function normalizeEmail(raw) {
  return raw ? raw.trim().toLowerCase() : null
}

/** Phones to E.164 with a default region of IN. */
export function normalizePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`
  return digits ? `+${digits}` : null
}

/** A cheap content hash — tier 3 of identity resolution: the same file again. */
export async function textHash(text) {
  const norm = (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm))
  return 'sha256:' + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function findSkills(text) {
  const hay = text.toLowerCase()
  return SKILL_VOCAB.filter((skill) => {
    const needle = skill.toLowerCase()
    // Word-boundary-ish match, but tolerant of the punctuation in "C#",
    // "Node.js" and "CI/CD", where \b does the wrong thing.
    const i = hay.indexOf(needle)
    if (i === -1) return false
    const before = hay[i - 1]
    const after = hay[i + needle.length]
    const isWordChar = (c) => c != null && /[a-z0-9]/.test(c)
    return !isWordChar(before) && !isWordChar(after)
  })
}

function findName(text) {
  // The name is almost always the first non-empty line that is not contact
  // details and not a section heading.
  for (const line of text.split('\n').slice(0, 8)) {
    const t = line.trim()
    if (!t || t.length > 48) continue
    if (EMAIL_RE.test(t) || PHONE_RE.test(t)) continue
    if (/resume|curriculum|vitae|profile|objective|summary/i.test(t)) continue
    if (/^[A-Za-z][A-Za-z.\-' ]{2,}$/.test(t) && t.split(/\s+/).length <= 4) {
      return t.replace(/\s+/g, ' ')
    }
  }
  return null
}

function findNumber(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const n = parseFloat(m[1])
      if (!Number.isNaN(n)) return n
    }
  }
  return null
}

/**
 * Parse resume text into the `parsed` sub-document of §9.4.
 *
 * Everything it returns is machine territory. The service layer writes these
 * under `parsed.*`; a recruiter's own edit is written top-level and a re-parse
 * never overwrites it.
 */
export function parseResume(text = '') {
  const skills = findSkills(text)
  const email = normalizeEmail(text.match(EMAIL_RE)?.[0])
  const phone = normalizePhone(text.match(PHONE_RE)?.[0])
  const name = findName(text)

  const experienceYears = findNumber(text, [
    /(\d+(?:\.\d+)?)\s*\+?\s*years?\s+(?:of\s+)?experience/i,
    /experience\s*[:-]\s*(\d+(?:\.\d+)?)/i,
    /total\s+experience\s*[:-]?\s*(\d+(?:\.\d+)?)/i,
  ])

  const noticeDays = (() => {
    const m = text.match(/notice\s*(?:period)?\s*[:-]?\s*(immediate|(\d+)\s*(day|month|week)s?)/i)
    if (!m) return null
    if (/immediate/i.test(m[1])) return 0
    const n = parseInt(m[2], 10)
    const unit = m[3].toLowerCase()
    return unit === 'month' ? n * 30 : unit === 'week' ? n * 7 : n
  })()

  const currentCtc = findNumber(text, [/current\s*ctc\s*[:-]?\s*(?:inr|rs\.?|₹)?\s*(\d+(?:\.\d+)?)/i])
  const expectedCtc = findNumber(text, [/expected\s*ctc\s*[:-]?\s*(?:inr|rs\.?|₹)?\s*(\d+(?:\.\d+)?)/i])

  const current = (() => {
    const m = text.match(/^\s*(?:current(?:ly)?\s+)?(?:working\s+as\s+|role\s*[:-]\s*|designation\s*[:-]\s*)(.+?)(?:\s+at\s+|\s*,\s*|\s+@\s*)(.+?)$/im)
    if (m) return { title: m[1].trim(), company: m[2].trim() }
    return { title: null, company: null }
  })()

  // First known city named in the resume's header, which is where people put
  // where they live. Only the top of the resume, so a past employer's city
  // further down does not win.
  const location = (() => {
    const head = text.split('\n').slice(0, 6).join(' ')
    for (const st of STATES) {
      for (const city of [...st.cities, ...(CITY_ALIASES[st.code] ?? [])]) {
        if (new RegExp(`\\b${city}\\b`, 'i').test(head)) {
          return { state: st.name, city: st.cities.includes(city) ? city : st.cities[0] }
        }
      }
    }
    return { state: null, city: null }
  })()

  const languages = LANGUAGE_VOCAB.filter((l) => new RegExp(`\\b${l}\\b`, 'i').test(text))

  const links = {
    linkedin: text.match(/https?:\/\/(?:www\.)?linkedin\.com\/\S+/i)?.[0] ?? null,
    github: text.match(/https?:\/\/(?:www\.)?github\.com\/\S+/i)?.[0] ?? null,
  }

  // Confidence is the share of the fields that actually came back. It exists so
  // a future parser upgrade can find and re-parse everything below a floor.
  const signals = [name, email, phone, skills.length > 0, experienceYears != null]
  const confidence = Number((signals.filter(Boolean).length / signals.length).toFixed(2))

  return {
    name, email, phone,
    parsed: {
      skills,
      languages,
      links,
      education: [],
      employment: [],
      parsed_at: new Date().toISOString(),
      parser_version: PARSER_VERSION,
      confidence,
    },
    total_experience_years: experienceYears,
    notice_period_days: noticeDays,
    current_ctc_lpa: currentCtc,
    expected_ctc_lpa: expectedCtc,
    current,
    location,
  }
}

const CITY_ALIASES = { KA: ['Bangalore'], TN: ['Madras'], MH: ['Bombay'], WB: ['Calcutta'], DL: ['Delhi'] }

/** True when the browser can read this file as text without a server. */
export function isReadableAsText(file) {
  return /\.(txt|md|csv|json|rtf)$/i.test(file.name) || file.type.startsWith('text/')
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(new Error(`Could not read ${file.name}`))
    r.readAsText(file)
  })
}
