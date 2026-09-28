// Job-portal profiles (Naukri Resdex cards, Naukri profiles, LinkedIn).
//
// A portal profile is not a resume: it is a labelled card. On Naukri:
//
//   Sudheer Shukla
//   6y 0m   ₹ 7.30 Lacs   Raipur
//   Current          Sales Officer at Parle Biscuits Pvt. Ltd.
//   Previous         Network Sales Executive at Pouring Pounds India Pvt. Ltd.
//   Education        B.Com Awadhesh pratap singh University, Rewa 2018
//   Pref. locations  Raipur, Durg, Bhilai
//   Key skills       Marketing | Retail Sales | Direct Sales | …
//   May also know    Distributor Handling | Sales Team Management …
//
// Reading the labels directly is far more reliable than running it through
// the resume parser, which only knows skills from its fixed list and would
// miss "FMCG Sales" and "Distributor Handling" entirely.

import { STATES } from './locations.js'

const LABELS = [
  ['current', /^current(?:\s+designation)?$/i],
  ['previous', /^previous(?:\s+designation)?$/i],
  ['education', /^(education|highest qualification)$/i],
  ['preferred_locations', /^pref(?:erred)?\.?\s+locations?$/i],
  ['key_skills', /^key\s*skills$/i],
  ['may_also_know', /^may also know$/i],
  ['headline', /^(headline|profile summary|summary)$/i],
]

/** Split "Label   value" (same line, tab or 2+ spaces) or "Label" + next line. */
function labelled(lines) {
  const out = {}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const [key, re] of LABELS) {
      if (out[key]) continue
      // Same line: "Current\tSales Officer at …" or "Current:  Sales Officer…"
      const m = line.match(/^([A-Za-z. ]{3,24}?)\s*(?::|\t|\s{2,})\s*(.+)$/)
      if (m && re.test(m[1].trim())) {
        out[key] = m[2].trim()
        break
      }
      if (re.test(line) && lines[i + 1]) {
        out[key] = lines[i + 1].trim()
        break
      }
    }
  }
  return out
}

// Naukri truncates the last item ("Sales Team Mana... more"). A half word is
// worse than no word, so a truncated item is dropped.
const splitSkills = (s) => (s ?? '').split(/\s*[|,•·]\s*/)
  .filter((x) => !/(\.{2,}|…)/.test(x))
  .map((x) => x.replace(/\bmore$/i, '').trim())
  .filter((x) => x.length > 1 && x.length < 40)

/** "Sales Officer at Parle Biscuits Pvt. Ltd." → { title, company } */
function role(s) {
  if (!s) return { title: null, company: null }
  const i = s.toLowerCase().lastIndexOf(' at ')
  return i === -1 ? { title: s.trim(), company: null } : { title: s.slice(0, i).trim(), company: s.slice(i + 4).trim() }
}

function knownCity(text) {
  for (const st of STATES) {
    for (const city of st.cities) {
      if (new RegExp(`\\b${city}\\b`, 'i').test(text)) return { state: st.name, city }
    }
  }
  return null
}

/**
 * Does this text look like a portal card? Two or more labels is a card; a
 * resume that happens to contain the word "Education" is not.
 */
export function looksLikePortalProfile(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  const found = labelled(lines)
  return Object.keys(found).length >= 2
}

export function parsePortalProfile(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  const fields = labelled(lines)
  const head = lines.slice(0, 8).join('  ')

  // "6y 0m", "6 Yrs 3 Mos", "6 years 3 months"
  const exp = head.match(/(\d+(?:\.\d+)?)\s*(?:y|yrs?|years?)\b\s*(?:(\d+)\s*(?:m|mos?|months?)\b)?/i)
  const years = exp ? Math.round((Number(exp[1]) + (exp[2] ? Number(exp[2]) / 12 : 0)) * 10) / 10 : null

  // "₹ 7.30 Lacs", "7.3 LPA", "₹ 45,000 per month" is left alone.
  const ctc = head.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:lacs?|lakhs?|lpa|l)\b/i)

  // Location: the first known city in the header, else the line after the CTC.
  const loc = knownCity(head)

  // The name is the first line that is not a number, label or UI text.
  const name = lines.find((l) =>
    /^[A-Za-z][A-Za-z.' -]{2,40}$/.test(l) && l.split(/\s+/).length <= 4 &&
    !LABELS.some(([, re]) => re.test(l)) && !/^(view|call|comment|save|verified)/i.test(l)) ?? null

  const current = role(fields.current)
  const previous = role(fields.previous)
  const skills = splitSkills(fields.key_skills)
  const alsoKnows = splitSkills(fields.may_also_know)

  return {
    name,
    total_experience_years: years,
    current_ctc_lpa: ctc ? Number(ctc[1]) : null,
    location: loc ?? { state: null, city: null },
    current,
    previous,
    education: fields.education ?? null,
    preferred_locations: splitSkills(fields.preferred_locations),
    headline: fields.headline ?? null,
    skills: [...new Set([...skills, ...alsoKnows])],
    // The first key skill Naukri shows is the candidate's own headline skill.
    primary_skill: skills[0] ?? null,
    labels_found: Object.keys(fields),
  }
}
