// Reference data (§9.9).
//
// State and city are validated against this list rather than typed free-hand —
// the walkthrough's complaint was that "Borivli" as a whole address is not
// acceptable. `area` stays free text precisely because it is the part nobody
// spells consistently.

export const STATES = [
  { code: 'MH', name: 'Maharashtra', cities: ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Thane', 'Aurangabad'] },
  { code: 'KA', name: 'Karnataka',   cities: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi'] },
  { code: 'DL', name: 'Delhi',       cities: ['New Delhi', 'Dwarka', 'Rohini'] },
  { code: 'TN', name: 'Tamil Nadu',  cities: ['Chennai', 'Coimbatore', 'Madurai'] },
  { code: 'TS', name: 'Telangana',   cities: ['Hyderabad', 'Warangal'] },
  { code: 'GJ', name: 'Gujarat',     cities: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot'] },
  { code: 'WB', name: 'West Bengal', cities: ['Kolkata', 'Howrah', 'Siliguri'] },
  { code: 'UP', name: 'Uttar Pradesh', cities: ['Noida', 'Lucknow', 'Ghaziabad', 'Kanpur'] },
  { code: 'HR', name: 'Haryana',     cities: ['Gurugram', 'Faridabad', 'Panipat'] },
  { code: 'RJ', name: 'Rajasthan',   cities: ['Jaipur', 'Jodhpur', 'Udaipur'] },
  { code: 'KL', name: 'Kerala',      cities: ['Kochi', 'Thiruvananthapuram', 'Kozhikode'] },
  { code: 'PB', name: 'Punjab',      cities: ['Mohali', 'Ludhiana', 'Amritsar', 'Jalandhar'] },
  { code: 'CG', name: 'Chhattisgarh', cities: ['Raipur', 'Durg', 'Bhilai', 'Bilaspur'] },
  { code: 'MP', name: 'Madhya Pradesh', cities: ['Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Rewa'] },
  { code: 'OD', name: 'Odisha',      cities: ['Bhubaneswar', 'Cuttack'] },
  { code: 'BR', name: 'Bihar',       cities: ['Patna'] },
  { code: 'AS', name: 'Assam',       cities: ['Guwahati'] },
  { code: 'CH', name: 'Chandigarh',  cities: ['Chandigarh'] },
  { code: 'AP', name: 'Andhra Pradesh', cities: ['Visakhapatnam', 'Vijayawada'] },
]

export const ZONES = ['North', 'South', 'East', 'West']

export function citiesOf(stateName) {
  return STATES.find((s) => s.name === stateName)?.cities ?? []
}

export function stateCode(stateName) {
  return STATES.find((s) => s.name === stateName)?.code ?? null
}

export const WORK_MODES = ['On-site', 'Hybrid', 'Remote']
export const EMPLOYMENT_TYPES = ['Full-time', 'Contract', 'Intern']
// `draft` is a job that exists but is not yet taking candidates — nothing is
// published anywhere until it moves to `active`.
export const JOB_STATUSES = ['draft', 'active', 'on_hold', 'closed', 'cancelled']
export const JOB_STATUS_LABEL = {
  draft: 'Draft', active: 'Active', on_hold: 'On hold', closed: 'Closed', cancelled: 'Cancelled',
}
export const EXPERIENCE_LEVELS = ['Fresher', 'Experienced', 'Senior', 'Lead']
export const HIRING_TYPES = ['IT', 'Sales', 'Operations', 'Finance', 'HR', 'Support']

// Interview languages. `speech` is the BCP-47 tag handed to the browser's
// speech engine (and, in the real system, to the TTS/STT provider) — always the
// Indian variant, so English is spoken with an Indian accent rather than an
// American one. `resume` is how the language appears on a resume, which is how
// the invite dialog suggests a language per candidate.
export const LANGUAGES = [
  { code: 'en-IN', label: 'English (India)',  native: 'English',  resume: 'English',   speech: 'en-IN', voice: 'alloy' },
  { code: 'hi-IN', label: 'हिन्दी / Hindi',     native: 'हिन्दी',    resume: 'Hindi',     speech: 'hi-IN', voice: 'shimmer' },
  { code: 'ta-IN', label: 'தமிழ் / Tamil',      native: 'தமிழ்',     resume: 'Tamil',     speech: 'ta-IN', voice: 'indic-ta' },
  { code: 'te-IN', label: 'తెలుగు / Telugu',    native: 'తెలుగు',    resume: 'Telugu',    speech: 'te-IN', voice: 'indic-te' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ / Kannada',     native: 'ಕನ್ನಡ',     resume: 'Kannada',   speech: 'kn-IN', voice: 'indic-kn' },
  { code: 'ml-IN', label: 'മലയാളം / Malayalam', native: 'മലയാളം',   resume: 'Malayalam', speech: 'ml-IN', voice: 'indic-ml' },
  { code: 'mr-IN', label: 'मराठी / Marathi',    native: 'मराठी',     resume: 'Marathi',   speech: 'mr-IN', voice: 'indic-mr' },
  { code: 'gu-IN', label: 'ગુજરાતી / Gujarati',  native: 'ગુજરાતી',   resume: 'Gujarati',  speech: 'gu-IN', voice: 'indic-gu' },
  { code: 'pa-IN', label: 'ਪੰਜਾਬੀ / Punjabi',    native: 'ਪੰਜਾਬੀ',    resume: 'Punjabi',   speech: 'pa-IN', voice: 'indic-pa' },
  { code: 'bn-IN', label: 'বাংলা / Bengali',     native: 'বাংলা',     resume: 'Bengali',   speech: 'bn-IN', voice: 'indic-bn' },
]

export const languageOptions = () => LANGUAGES.map((l) => ({ value: l.code, label: l.label }))
export const languageByCode = (code) => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]

/** Languages from a parsed resume that we can interview in, in resume order. */
export function interviewLanguagesFor(candidate) {
  const listed = candidate?.parsed?.languages ?? []
  return LANGUAGES.filter((l) => listed.includes(l.resume))
}

// Where a candidate came from. Shown on every pipeline row, because "who added
// this person, and from where" is the first question in a hiring review.
export const SOURCE_CHANNELS = {
  manual_entry:  'Added manually',
  manual:        'Added manually',
  resume_upload: 'Resume upload',
  database:      'From database',
  linkedin:      'LinkedIn',
  naukri:        'Naukri',
  career_portal: 'Career portal',
  referral:      'Referral',
}
export const sourceLabel = (channel) => SOURCE_CHANNELS[channel] ?? (channel ?? '—').replace(/_/g, ' ')

export const ALLOWED_DURATIONS = [15, 20, 30, 45]
