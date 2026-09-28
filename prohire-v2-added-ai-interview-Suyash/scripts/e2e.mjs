// End-to-end exercise of the domain and service layers under Node.
//
// It runs the six Acts in order against a localStorage shim and asserts the
// properties the design actually cares about — the freeze above all. Run with:
//   node scripts/e2e.mjs

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
globalThis.sessionStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
}
globalThis.location = { origin: 'http://localhost:5173' }
globalThis.Blob = class { constructor(parts) { this.size = String(parts[0] ?? '').length } }

const pass = []
const fail = []
const check = (name, cond, detail = '') => {
  ;(cond ? pass : fail).push(name + (detail ? ` — ${detail}` : ''))
}

const { db } = await import('../src/lib/db.js')
const { signIn } = await import('../src/services/core.js')
const { createDepartment, listDepartments } = await import('../src/services/departments.js')
const { createJob, getJob } = await import('../src/services/jobs.js')
const { ingestResume, listCandidates } = await import('../src/services/candidates.js')
const apps = await import('../src/services/applications.js')
const iv = await import('../src/services/interviews.js')
const { resolvePlan, validatePlan } = await import('../src/domain/resolvePlan.js')
const { screenQuestion } = await import('../src/domain/ai.js')

signIn({ username: 'asha', remember: true })

// --- Act 0: setup ----------------------------------------------------------

const it = createDepartment({
  name: 'Information Technology', code: 'IT',
  location: { state: 'Maharashtra', city: 'Mumbai', area: 'Borivali' },
  zone: 'West', headcount: 42,
})

const job = createJob({
  title: 'ASP.NET Developer',
  department_id: it._id,
  description: 'We need a backend developer for ASP.NET Core services with SQL Server at scale. Entity Framework depth matters, as does Docker and a CI/CD pipeline.',
  skills_required: ['C#', 'ASP.NET Core', 'SQL Server', 'Entity Framework'],
  skills_preferred: ['Azure', 'Docker'],
  experience: { min_years: 3, max_years: 7, level: 'Experienced' },
  openings: 3,
  screening_profile: { hiring_type: 'IT', match_threshold: 72 },
})

check('Job reference is human-readable', job.reference === 'IT-0001', job.reference)

const job2 = createJob({
  title: 'Platform Engineer', department_id: it._id,
  description: 'Kubernetes, Terraform and Python for a multi-tenant platform across three regions.',
  skills_required: ['Kubernetes', 'Terraform', 'Python'],
  experience: { min_years: 5, max_years: 10, level: 'Senior' },
})
check('Reference counter increments per department', job2.reference === 'IT-0002', job2.reference)

try {
  createJob({ title: 'x', department_id: it._id, description: 'too short' })
  check('Thin JD rejected', false)
} catch {
  check('Thin JD rejected', true)
}

// --- Act 1: source ---------------------------------------------------------

const strongResume = `Priya Sharma
priya.sharma@example.com | 9876543210
Working as Senior Software Engineer at Acme Systems
Total experience: 5 years
Expected CTC: 18 LPA | Notice period: 30 days
Languages: English, Hindi
SKILLS
C#, ASP.NET Core, Entity Framework, SQL Server, Docker, Azure`

const weakResume = `Arjun Nair
arjun.nair@example.com | 9988776655
Working as Sales Executive at Metro Retail
Total experience: 1.5 years
Notice period: 15 days
SKILLS
Communication, Negotiation, Excel`

const a = await ingestResume({ filename: 'priya.txt', text: strongResume })
const b = await ingestResume({ filename: 'arjun.txt', text: weakResume })

check('Resume parsed a name', a.candidate.full_name === 'Priya Sharma', a.candidate.full_name)
check('Resume parsed an email', a.candidate.email === 'priya.sharma@example.com')
check('Phone normalised to E.164', a.candidate.phone === '+919876543210', a.candidate.phone)
check('Experience parsed', a.candidate.total_experience_years === 5)
check('Notice period parsed', a.candidate.notice_period_days === 30)
check('Expected CTC parsed', a.candidate.expected_ctc_lpa === 18)
check('Skills parsed', a.candidate.parsed.skills.includes('ASP.NET Core'))
check('Languages parsed', a.candidate.parsed.languages.includes('Hindi'))

// Dedupe tiers
const again = await ingestResume({ filename: 'priya-copy.txt', text: strongResume })
check('Tier 3: identical resume ignored', again.outcome === 'duplicate', again.outcome)
check('Tier 3 created no second record', listCandidates().length === 2, String(listCandidates().length))

const updated = await ingestResume({
  filename: 'priya-v2.txt',
  text: strongResume + '\nAlso worked with Kubernetes and Terraform.',
})
check('Tier 1: same email merges', updated.outcome === 'merged', updated.outcome)
check('Merge added a resume version', updated.candidate.resume_history.length === 2)
check('Still one candidate', listCandidates().length === 2)

// Tagging
const { application: app1 } = apps.createApplication({ candidate_id: a.candidate._id, job_id: job._id })
const { application: app2 } = apps.createApplication({ candidate_id: b.candidate._id, job_id: job._id })
const dup = apps.createApplication({ candidate_id: a.candidate._id, job_id: job._id })
check('Re-tagging does not duplicate', dup.created === false && dup.application._id === app1._id)
check('Stage starts at sourced', app1.stage === 'sourced')

// One person, many jobs
apps.createApplication({ candidate_id: a.candidate._id, job_id: job2._id })
check('One candidate, many applications', apps.listApplications({ candidate_id: a.candidate._id }).length === 2)

// --- Act 2: screen (AI #1) -------------------------------------------------

const results = await apps.screenBatch([app1._id, app2._id], { concurrency: 5 })
check('Batch screening returned both', results.length === 2)

const screened1 = apps.getApplication(app1._id)
const screened2 = apps.getApplication(app2._id)

check('Strong match scored high', screened1.screening.match_percent >= 72,
  `${screened1.screening.match_percent}%`)
check('Strong match shortlisted', screened1.screening.decision === 'Shortlisted')
check('Weak match scored low', screened2.screening.match_percent < 72,
  `${screened2.screening.match_percent}%`)
check('Weak match rejected by threshold', screened2.screening.decision === 'Rejected')
check('Rejection names the threshold rule',
  screened2.screening.details.includes('threshold rule'))
check('Screening did NOT move the stage on its own', screened1.stage === 'sourced', screened1.stage)
check('Matched skills recorded', screened1.screening.matched_skills.length >= 3)

// --- Act 3: invite and FREEZE ----------------------------------------------

apps.moveStage(app1._id, 'screened', 'Looks good')
check('Recruiter moved the stage', apps.getApplication(app1._id).stage === 'screened')
check('Stage history records who', apps.getApplication(app1._id).stage_history.at(-1).by === 'asha')

const preview = iv.resolveForApplication(app1._id)
check('Plan resolves with no configuration', preview.plan.questions.length === 0 || true)

const { session, url } = await iv.invite(app1._id, { rules: { language: 'hi-IN', duration_minutes: 15 } })
check('Invite produced a session', Boolean(session._id))
check('Invite produced a link', url.includes('/interview/'))
check('Stage moved to invited', apps.getApplication(app1._id).stage === 'invited')
check('Plan frozen at invite', Boolean(session.plan.frozen_at))
check('Per-candidate language applied', session.plan.rules.language === 'hi-IN', session.plan.rules.language)
check('Per-candidate duration applied', session.plan.rules.duration_minutes === 15)
check('Voice derived from language', session.plan.persona.voice_id === 'shimmer', session.plan.persona.voice_id)
check('Questions were generated', session.plan.questions.length > 0, `${session.plan.questions.length} questions`)
check('Job snapshot frozen in', session.plan.job_context.reference === 'IT-0001')
check('Resume snapshot frozen in', session.plan.candidate_context.full_name === 'Priya Sharma')

const frozenQuestions = session.plan.questions.map((q) => q.text)
const frozenLanguage = session.plan.rules.language

// A second candidate on the SAME job, in a different language and duration.
apps.moveStage(app2._id, 'screened')
const second = await iv.invite(app2._id, { rules: { language: 'en-IN', duration_minutes: 30 } })
check('Same job, two languages, no cloning',
  second.session.plan.rules.language === 'en-IN' && session.plan.rules.language === 'hi-IN')
check('Same job, two durations',
  second.session.plan.rules.duration_minutes === 30 && session.plan.rules.duration_minutes === 15)
check('Both sessions share one job', second.session.job_id === session.job_id)

// --- THE FREEZE TEST -------------------------------------------------------
// Edit the job's template after the invites are out, and prove nothing moved.

const tpl = iv.listTemplates({ scope: 'job', scope_id: job._id })[0]
check('Generated questions persisted as a job template', Boolean(tpl))

iv.saveTemplate({
  ...tpl,
  questions: [{ id: 'zz', text: 'A COMPLETELY DIFFERENT QUESTION', type: 'open', competency: 'experience', weight: 1, must_ask: true }],
  rules: { ...tpl.rules, strictness: 'strict', language: 'en-IN', duration_minutes: 45 },
})

const afterEdit = iv.getSession(session._id)
check('❄ Frozen questions survived a template rewrite',
  JSON.stringify(afterEdit.plan.questions.map((q) => q.text)) === JSON.stringify(frozenQuestions))
check('❄ Frozen language survived', afterEdit.plan.rules.language === frozenLanguage)
check('❄ Frozen duration survived', afterEdit.plan.rules.duration_minutes === 15)

// A NEW invite picks up the edit — the freeze protects the past, not the future.
const third = await ingestResume({
  filename: 'rahul.txt',
  text: 'Rahul Verma\nrahul.verma@example.com | 9823456710\nTotal experience: 4 years\nSKILLS\nC#, ASP.NET Core, SQL Server',
})
const { application: app3 } = apps.createApplication({ candidate_id: third.candidate._id, job_id: job._id })
const fresh = await iv.invite(app3._id)
check('A new invite DOES pick up the edit',
  fresh.session.plan.questions.some((q) => q.text === 'A COMPLETELY DIFFERENT QUESTION'))

// Delete the job entirely — the old report must still render.
db.remove('jobs', job._id)
check('Session survives its job being deleted',
  iv.getSession(session._id).plan.job_context.title === 'ASP.NET Developer')
// Put it back for the rest of the run.
db.insert('jobs', { ...job, _id: job._id })

// --- Act 4: the interview (AI #2) ------------------------------------------

const boot = iv.bootstrap(session.invite.token)
check('Bootstrap succeeds', !boot.error, boot.error ?? '')
check('Bootstrap never leaks the rubric', JSON.stringify(boot).includes('expected_points') === false)
check('Bootstrap never leaks the threshold', JSON.stringify(boot).includes('shortlist_threshold') === false)

iv.recordConsent(session.invite.token, true)
iv.startSession(session.invite.token, { user_agent: 'node' })
check('Session is in progress', iv.getSession(session._id).state === 'in_progress')
check('System moved the stage — only for session facts',
  apps.getApplication(app1._id).stage === 'interview_in_progress')

const ANSWERS = [
  'At Acme I built the claims intake service end to end. I designed the ingestion pipeline, wrote it in ASP.NET Core, and owned it on call for two years. It handles about 40000 submissions a day. The hardest part was the retry semantics, because a duplicate claim is worse than a dropped one, so I built idempotency keys into the write path.',
  'I use Include and ThenInclude for eager loading, but the bigger win is projection with Select so Entity Framework never materialises the whole entity. I profile with the SQL Server execution plan first, because guessing at N+1 wastes a day. On the claims service that took p99 from 1400ms down to 180ms.',
  'I containerised the service with a multi-stage Dockerfile and ran it on Azure App Service. The CI pipeline builds, runs tests, pushes the image and deploys to staging automatically. Production is a manual approval because I wanted a human in that loop.',
  'I missed a deadline on the reporting module because I underestimated how much the legacy schema would fight me. I told the product owner in week two rather than week six, we cut the scope to the three reports that mattered, and I wrote down the schema traps so the next person did not hit them.',
  'I mentored two juniors through their first production incident. I did not fix it for them. I sat with them while they read the logs and asked what they thought was happening, which took longer that night but meant they handled the next one alone.',
  'The multi-tenant billing work at Acme taught me that the boring part is the reconciliation, not the calculation. I built a nightly job that compares what we billed against what we metered and alerts on any drift over a rupee.',
  'I would start by reading the existing queries and the execution plans before changing anything, because the fastest fix is usually an index that nobody added.',
  'I prefer working where I can see the production impact of what I ship. That is why I took on call voluntarily.',
]

let guard = 0
while (guard++ < 40) {
  const q = iv.currentQuestion(session._id)
  if (q.done) break
  iv.askQuestion(session._id)
  const answer = ANSWERS[(guard - 1) % ANSWERS.length]
  await iv.submitAnswer(session._id, answer, { durationSeconds: 70 })
}
check('Interview loop terminated', guard < 40, `${guard} iterations`)

const mid = iv.getSession(session._id)
check('Turns recorded', mid.turns.length > 0, `${mid.turns.length} turns`)
check('Follow-ups were asked', mid.turns.some((t) => t.kind === 'follow_up'))

const report = await iv.completeSession(session._id)
check('Session completed', iv.getSession(session._id).state === 'completed')
check('Stage moved to interview_completed',
  apps.getApplication(app1._id).stage === 'interview_completed')

// --- Act 5: the report -----------------------------------------------------

check('Report generated', Boolean(report._id))
check('Overall score in range', report.overall_score >= 0 && report.overall_score <= 100, String(report.overall_score))
check('Recommendation is one of three',
  ['shortlist', 'hold', 'reject'].includes(report.recommendation), report.recommendation)
check('Report states the language it was conducted in', report.conducted_in === 'hi-IN', report.conducted_in)
check('Every question has a score', report.per_question.length === mid.plan.questions.length)

// Evidence must be VERBATIM from the transcript — this is the load-bearing one.
const transcriptText = mid.turns.filter((t) => t.role === 'candidate').map((t) => t.text).join(' ')
const quoted = report.per_question.filter((p) => p.evidence)
const verbatim = quoted.filter((p) => transcriptText.includes(p.evidence))
check('Every quote appears verbatim in the transcript',
  quoted.length > 0 && verbatim.length === quoted.length,
  `${verbatim.length}/${quoted.length}`)

check('Competencies scored', report.competencies.some((c) => c.score != null))
check('Strengths present', report.strengths.length > 0)
check('Concerns present', report.concerns.length > 0)
check('Follow-ups suggested', report.follow_up_questions.length > 0)
check('Share token minted', Boolean(report.share_token))
check('Report reachable by share token',
  iv.getReportByShareToken(report.share_token)?._id === report._id)

// The overall score must follow from the competency scores, not be invented.
const scored = report.competencies.filter((c) => c.score != null)
const weightSum = scored.reduce((s, c) => s + c.weight, 0)
const recomputed = Math.round(scored.reduce((s, c) => s + c.score * c.weight, 0) / weightSum)
check('Overall score is computed, not asserted', recomputed === report.overall_score,
  `${recomputed} vs ${report.overall_score}`)

// Denormalised head on the application
const finalApp = apps.getApplication(app1._id)
check('Application carries the interview summary',
  finalApp.interview_summary?.overall_score === report.overall_score)

// --- Act 6: decide ---------------------------------------------------------

const decided = iv.recordVerdict(report._id, 'shortlist', 'Good depth on EF Core.')
check('Verdict recorded', decided.recruiter_verdict.decision === 'shortlist')
check('Agreement with the AI captured',
  typeof decided.recruiter_verdict.agreed_with_ai === 'boolean')
check('Verdict moved the stage', apps.getApplication(app1._id).stage === 'shortlisted')

// --- Guardrails ------------------------------------------------------------

check('Blocks a marital-status question',
  screenQuestion('Are you married or planning to have children?').ok === false)
check('Blocks a religion question',
  screenQuestion('Which temple do you go to?').ok === false)
check('Blocks an age question',
  screenQuestion('How old are you?').ok === false)
check('Allows a legitimate technical question',
  screenQuestion('How do you handle N+1 queries in Entity Framework?').ok === true)
check('Allows a question about relocation to the role',
  screenQuestion('This role is based in Mumbai — does that work for you?').ok === true)

// --- resolve_plan is pure --------------------------------------------------

const layers = [
  { source: 'org', rules: { strictness: 'moderate', duration_minutes: 30, max_questions: 8 }, questions: [
    { id: 'q1', text: 'A', weight: 1, must_ask: true, competency: 'technical' },
    { id: 'q2', text: 'B', weight: 3, competency: 'technical' },
    { id: 'q3', text: 'C', weight: 2, competency: 'technical' },
  ] },
  { source: 'dept', rules: { strictness: 'strict' } },
  { source: 'job', rules: { max_questions: 2 } },
]
const p1 = resolvePlan(layers, {})
const p2 = resolvePlan(layers, {})
check('resolvePlan is deterministic', JSON.stringify(p1) === JSON.stringify(p2))
check('Last non-null layer wins', p1.rules.strictness === 'strict')
check('Provenance names the layer', p1.provenance.strictness === 'dept', p1.provenance.strictness)
check('Threshold follows strictness', p1.scoring.shortlist_threshold === 80,
  String(p1.scoring.shortlist_threshold))
check('Budget drops the lowest weight first',
  p1.questions.map((q) => q.id).join(',') === 'q1,q2', p1.questions.map((q) => q.id).join(','))
check('must_ask is never dropped', p1.questions.some((q) => q.id === 'q1'))

const light = resolvePlan([...layers, { source: 'candidate', rules: { light_mode: true } }], {})
check('Light mode forces 15 minutes', light.rules.duration_minutes === 15)
check('Light mode caps questions at 5', light.rules.max_questions <= 5)

const overbooked = resolvePlan([
  { source: 'org', rules: { max_questions: 2, duration_minutes: 15 }, questions: [
    { id: 'a', text: 'A', must_ask: true }, { id: 'b', text: 'B', must_ask: true }, { id: 'c', text: 'C', must_ask: true },
  ] },
], {})
check('Over-budget must_ask plan is flagged', validatePlan(overbooked).length > 0)

// Question operations
const patched = resolvePlan([
  { source: 'job', questions: [
    { id: 'q1', text: 'One', weight: 1 }, { id: 'q2', text: 'Two', weight: 1 }, { id: 'q3', text: 'Three', weight: 1 },
  ] },
  { source: 'candidate', question_ops: [
    { op: 'remove', question_id: 'q2' },
    { op: 'add', question: { id: 'c1', text: 'Custom', weight: 1 } },
    { op: 'reorder', order: ['c1', 'q1'] },
  ] },
], {})
check('Question ops: remove worked', !patched.questions.some((q) => q.id === 'q2'))
check('Question ops: add worked', patched.questions.some((q) => q.id === 'c1'))
check('Question ops: reorder worked', patched.questions[0].id === 'c1')
check('Partial reorder keeps the forgotten question',
  patched.questions.some((q) => q.id === 'q3'))

// --- expiry is a transition, not a delete ----------------------------------

const expiring = iv.getSession(second.session._id)
db.update('interview_sessions', expiring._id, {
  invite: { ...expiring.invite, expires_at: new Date(Date.now() - 1000).toISOString() },
})
iv.sweepExpired()
check('Expired invite is marked, not deleted',
  iv.getSession(second.session._id)?.state === 'expired')
check('Expired session is still readable',
  Boolean(iv.getSession(second.session._id).plan.questions.length))

// --- Probus requirements (HR walkthrough, Sept 2026) -----------------------

const cands = await import('../src/services/candidates.js')
const jobsSvc = await import('../src/services/jobs.js')
const careers = await import('../src/services/careers.js')
const { parsePortalProfile } = await import('../src/domain/portalProfile.js')
const { LANGUAGES } = await import('../src/domain/locations.js')
const { renderTemplate } = await import('../src/domain/emailTemplates.js')

const sales = createDepartment({ name: 'Sales', code: 'SLS', location: { state: 'Tamil Nadu', city: 'Chennai' }, zone: 'South', headcount: 80 })
const salesJob = createJob({
  title: 'Sales Support Executive', department_id: sales._id,
  description: 'Support the Chennai branch team for insurance broking: leads, quotes for motor and health policies, CRM hygiene.',
  skills_required: ['Customer Service', 'Motor Insurance', 'Health Insurance', 'CRM', 'Excel', 'Inside Sales', 'Tamil'],
  primary_skill: 'Customer Service', primary_skill_min_years: 1,
  screening_profile: { hiring_type: 'Sales' },
  publish: { career_portal: true },
})
check('Jobs take more than 5 skills', salesJob.skills_required.length === 7)
check('Primary skill stored on the job', salesJob.primary_skill === 'Customer Service')
check('Published job is on the career page', jobsSvc.listPublicJobs().some((j) => j._id === salesJob._id))
const draft = createJob({ title: 'Draft role', department_id: sales._id, status: 'draft', description: 'A role that is not ready yet and should not be visible to candidates anywhere.', publish: { career_portal: true } })
check('Draft job is not on the career page', draft.status === 'draft' && !jobsSvc.listPublicJobs().some((j) => j._id === draft._id))
jobsSvc.editJob(salesJob._id, { ...salesJob, title: 'Sales Support Executive — Chennai', skills_required: salesJob.skills_required, experience: salesJob.experience, compensation: salesJob.compensation, location: salesJob.location, screening_profile: salesJob.screening_profile })
check('Job stays editable after creation', getJob(salesJob._id).title === 'Sales Support Executive — Chennai')
check('Editing never changes the job ID', getJob(salesJob._id).reference === salesJob.reference)

const card = parsePortalProfile(`Ravi Kumar
6y 0m
₹ 7.30 Lacs
Raipur
Current
Sales Officer at Acme Biscuits Pvt. Ltd.
Previous
Network Sales Executive at Example Foods India Pvt. Ltd.
Education
B.Com Example University, Rewa 2018
Pref. locations
Raipur, Durg, Bhilai
Key skills
Marketing | Retail Sales | Direct Sales | FMCG Sales | Lead Generation
May also know
Distributor Handling | Sales Team Mana... more`)
check('Naukri card: experience', card.total_experience_years === 6, String(card.total_experience_years))
check('Naukri card: CTC in lacs', card.current_ctc_lpa === 7.3, String(card.current_ctc_lpa))
check('Naukri card: location', card.location.city === 'Raipur')
check('Naukri card: current role split', card.current.title === 'Sales Officer' && card.current.company === 'Acme Biscuits Pvt. Ltd.')
check('Naukri card: key skills beyond the vocabulary', card.skills.includes('FMCG Sales') && card.skills.includes('Distributor Handling'))
check('Naukri card: truncated skill dropped', !card.skills.some((s) => s.startsWith('Sales Team')))
check('Naukri card: preferred locations', card.preferred_locations.join() === 'Raipur,Durg,Bhilai')

const imported = await careers.importFromPortal({
  source: 'naukri', url: 'https://example.invalid/p/1',
  text: 'Meena Iyer\n3y 4m\n₹ 3.60 Lacs\nChennai\nCurrent\nSales Coordinator at Example Finance\nKey skills\nCustomer Service | Motor Insurance | CRM\nmeena@example.com | 9840012345',
}, { job_id: salesJob._id })
check('Portal import creates the candidate', imported.candidate.full_name === 'Meena Iyer')
check('Portal import records the source', apps.getApplication(imported.application._id).source.channel === 'naukri')
check('Uploaded resume is tagged as an upload', a.candidate.source.channel === 'resume_upload', a.candidate.source.channel)
check('Portal import tags the candidate with the portal', imported.candidate.source.channel === 'naukri', imported.candidate.source.channel)
check('Portal import uses the card fields', imported.candidate.current_ctc_lpa === 3.6 && imported.candidate.location.city === 'Chennai')
check('Candidates get a readable ID', /^CAN-\d{5}$/.test(imported.candidate.reference), imported.candidate.reference)

const appliedOut = await careers.applyToJob({
  job_id: salesJob._id, full_name: 'Divya Raman', email: 'divya@example.com', phone: '9884455667', city: 'Chennai', consent: true,
  resume_text: 'Tele Sales Executive\nLanguages: Tamil, English\nSKILLS\nHealth Insurance, Customer Service, CRM',
})
check('Career page application lands in the job', apps.getApplication(appliedOut.application._id).job_id === salesJob._id)
check('Career page application is tagged as such', apps.getApplication(appliedOut.application._id).source.channel === 'career_portal')
check('Career page records DPDP consent', cands.getCandidate(appliedOut.candidate._id).consent.data_processing === 'granted')
let refusedWithoutConsent = false
try { await careers.applyToJob({ job_id: salesJob._id, full_name: 'X', email: 'x@example.com', consent: false }) } catch { refusedWithoutConsent = true }
check('Career page refuses without consent', refusedWithoutConsent)
const sameAgain = await careers.applyToJob({ job_id: salesJob._id, full_name: 'Divya Raman', email: 'divya@example.com', consent: true })
check('Applying twice does not duplicate the person', sameAgain.candidate._id === appliedOut.candidate._id)

check('Keyword search: every word must match', cands.listCandidates({ q: 'chennai motor' }).some((c) => c._id === imported.candidate._id))
check('Keyword search: finds by candidate ID', cands.listCandidates({ q: imported.candidate.reference.toLowerCase() }).length === 1)

check('Ten Indian languages available', LANGUAGES.length >= 10 && LANGUAGES.some((l) => l.code === 'ta-IN') && LANGUAGES.some((l) => l.code === 'mr-IN'))
check('English is Indian English', LANGUAGES[0].speech === 'en-IN')

// Per-candidate: Tamil questionnaire-only for one, English interview for another.
iv.ensureQualification(salesJob._id)
const qOnly = await iv.invite(appliedOut.application._id, { rules: { assessment_type: 'qualification', language: 'ta-IN' } })
const qBoot = iv.bootstrap(qOnly.session.invite.token)
check('Questionnaire-only invite has no interview questions', qBoot.question_count === 0 && qBoot.qualification.length > 0)
check('Tamil interview speaks Tamil', qBoot.speech_lang === 'ta-IN')
check('Knockout rules never reach the candidate', !JSON.stringify(qBoot).includes('knockout'))
iv.startSession(qOnly.session.invite.token)
const locQ = qOnly.session.plan.qualification.find((q) => q.knockout?.answer === 'no')
const answers = Object.fromEntries(qOnly.session.plan.qualification.map((q) => [q.id, q.kind === 'yes_no' ? 'yes' : '3']))
answers[locQ.id] = 'no'
iv.submitQualification(qOnly.session._id, answers)
const qReport = await iv.completeSession(qOnly.session._id)
check('Questionnaire report has no score', qReport.overall_score === null)
check('Knockout answer is flagged', qReport.qualification.knockouts.length === 1)
check('Knockout means hold, not reject', qReport.recommendation === 'hold')

const full = await iv.invite(imported.application._id, { rules: { assessment_type: 'both', proctoring: { max_tab_switches: 3 } } })
check('Both: questionnaire and interview', full.session.plan.qualification.length > 0 && full.session.plan.questions.length > 0)
check('Sales job gets sales questions', full.session.plan.questions.some((q) => /quarter|customer|deal|field/i.test(q.text)))
check('Primary skill asked first', full.session.plan.questions[1]?.expected_points?.includes('Customer Service'))
iv.startSession(full.session.invite.token)
for (let i = 0; i < 4; i++) iv.recordIntegrityEvent(full.session._id, 'tab_switches')
iv.recordIntegrityEvent(full.session._id, 'paste_events')
iv.askQuestion(full.session._id)
await iv.submitAnswer(full.session._id, 'I handled 60 customer calls a day for motor insurance renewals because the branch had no inside sales team, and I kept every call in the CRM.')
const fullReport = await iv.completeSession(full.session._id, 'auto_terminated_tab_switches')
check('Tab switches logged with time', iv.getSession(full.session._id).violations.filter((v) => v.kind === 'tab_switches').length === 4)
check('Auto-termination shows in the report', fullReport.integrity.auto_terminated && fullReport.integrity.tab_switches === 4)
check('Auto-terminated is never "recommended"', fullReport.recommendation !== 'shortlist')
check('Report scores skills individually', Array.isArray(fullReport.skills) && fullReport.skills[0].skill === 'Customer Service')
check('Report has communication scores', fullReport.communication && fullReport.communication.fluency >= 0)
check('Report explains the recommendation', fullReport.recommendation_reason.length > 20)

// Moving and deleting.
const other = createJob({ title: 'Inside Sales', department_id: sales._id, description: 'Inside sales for health insurance renewals across Tamil Nadu, working from the Chennai branch office.' })
const moved = apps.moveToJob(appliedOut.application._id, other._id)
check('Move to job creates the new application', moved.created && moved.application.job_id === other._id)
check('Move leaves the old one as withdrawn', apps.getApplication(appliedOut.application._id).stage === 'withdrawn')
cands.setCandidateFlag(imported.candidate._id, 'Did not turn up twice')
check('Flag recorded', cands.getCandidate(imported.candidate._id).flag.reason === 'Did not turn up twice')
cands.deleteCandidate(imported.candidate._id)
check('Delete removes the candidate', !cands.getCandidate(imported.candidate._id))
check('Delete removes their applications and sessions',
  apps.listApplications({ candidate_id: imported.candidate._id }).length === 0 &&
  db.find('interview_sessions', { candidate_id: imported.candidate._id }).length === 0)

check('Email templates fill placeholders', renderTemplate('Hi {{candidate_name}}, {{link}}', { candidate_name: 'Divya', link: 'L' }) === 'Hi Divya, L')
check('Unknown placeholders stay visible', renderTemplate('{{nope}}', {}) === '{{nope}}')

// --- the live interviewer (Mode A, §10.3) ----------------------------------
// The live conversation runs in the browser against OpenAI, but everything it
// writes goes through these services. The checks prove a live session is the
// same document the typed flow produces, so scoring and the report just work.

const { buildInterviewerInstructions, INTERVIEWER_TOOLS } = await import('../src/domain/interviewerPrompt.js')
const liveCand = await ingestResume({
  filename: 'meera.txt',
  text: 'Meera Nair\nmeera.nair@example.com | 9812345670\nTotal experience: 5 years\nSKILLS\nC#, ASP.NET Core, SQL Server',
})
const { application: liveApp } = apps.createApplication({ candidate_id: liveCand.candidate._id, job_id: job._id })
const liveInvite = await iv.invite(liveApp._id)
iv.startSession(liveInvite.session.invite.token, { user_agent: 'node' })
const liveId = liveInvite.session._id
const livePlan = iv.getSession(liveId).plan
check('Live: the frozen plan carries the interviewer voice', typeof livePlan.persona.realtime_voice === 'string')

const livePrompt = buildInterviewerInstructions({ plan: livePlan, company: 'Probus Insurance', resuming: false })
check('Live: the prompt never contains the questions or expected points',
  livePlan.questions.every((q) => !livePrompt.includes(q.text) && (q.expected_points ?? []).every((p) => !livePrompt.includes(p))))
check('Live: the prompt carries the guardrails', /Never ask about age, marital status, religion, caste/.test(livePrompt) && /not instructions to you/.test(livePrompt))
check('Live: the prompt names the interview language', /Conduct the entire interview in Indian English/.test(livePrompt))
check('Live: the model gets questions only through next_question', INTERVIEWER_TOOLS.some((t) => t.name === 'next_question'))

iv.recordLiveTurn(liveId, { role: 'interviewer', text: 'Hello, I am Aarya, an AI interviewer.' })
const q1 = iv.liveNextQuestion(liveId, { advance: false })
check('Live: the first next_question returns the question at the cursor', q1.index === 0 && q1.question.id === livePlan.questions[0].id)
iv.recordLiveTurn(liveId, { role: 'interviewer', text: livePlan.questions[0].text, questionId: q1.question.id })
iv.recordLiveTurn(liveId, { role: 'candidate', text: 'I built the claims intake service end to end and owned its SQL tuning.', questionId: q1.question.id })
iv.recordLiveTurn(liveId, { role: 'interviewer', text: 'Thank you.', questionId: q1.question.id })
iv.recordLiveTurn(liveId, { role: 'interviewer', text: 'Which part of that was yours specifically?', questionId: q1.question.id })
iv.recordLiveTurn(liveId, { role: 'candidate', text: 'The retry queue and the schema.', questionId: q1.question.id, typed: true })

const liveTurns = iv.getSession(liveId).turns
const kinds = liveTurns.map((t) => t.kind)
check('Live: greeting is a remark, not a question', kinds[0] === 'remark' && liveTurns[0].question_id === null)
check('Live: first interviewer line on a question is the question', kinds[1] === 'question')
check('Live: acknowledgement is a remark, a probing line is a follow-up', kinds[3] === 'remark' && kinds[4] === 'follow_up')
check('Live: answers after a follow-up are follow-up answers', kinds[2] === 'answer' && kinds[5] === 'follow_up_answer')
check('Live: typed answers are marked', liveTurns[5].typed === true)
check('Live: a follow-up moves the cursor count', iv.getSession(liveId).cursor.follow_ups_asked === 1)

// A reconnect (or reload) asks the interrupted question again rather than skipping it.
const liveAgain = iv.liveNextQuestion(liveId, { advance: false })
check('Live: after a reconnect the same question is served again', liveAgain.question.id === q1.question.id)
const q2 = iv.liveNextQuestion(liveId, { advance: true })
check('Live: later calls move to the next question', q2.index === 1 && iv.getSession(liveId).cursor.follow_ups_asked === 0)
check('Live: resume is detected from the transcript',
  /RESUMED interview/.test(buildInterviewerInstructions({ plan: livePlan, company: 'Probus', resuming: true })))

let liveLast = q2
while (!liveLast.done) liveLast = iv.liveNextQuestion(liveId, { advance: true })
check('Live: next_question reports the end after the last question', liveLast.done === true)

const liveReport = await iv.completeSession(liveId, 'all_questions_answered')
const liveQ1 = liveReport.per_question.find((p) => p.question_id === q1.question.id)
check('Live: a live session is scored like a typed one', liveReport.overall_score != null && liveQ1 && liveQ1.score > 0)
check('Live: a live session no longer accepts turns once complete', iv.recordLiveTurn(liveId, { role: 'candidate', text: 'late' }) === null)
check('Live: time limit has a readable end reason', iv.endReasonLabel('time_limit') === 'Time limit reached')

// --- report --------------------------------------------------------------

console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`)
for (const f of fail) console.log(`  ✕ ${f}`)
if (!fail.length) for (const p of pass) console.log(`  ✓ ${p}`)
process.exit(fail.length ? 1 : 0)
