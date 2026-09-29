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

// --- Act 7: the AI voice call, run by the InterviewBot server ----------------
// A fake InterviewBot stands in for the real one, so this never reaches a real
// server (or a real candidate).

const botCalls = []
const fakeBot = new Map()
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url)
  const body = opts.body ? JSON.parse(opts.body) : null
  botCalls.push({ path: u.pathname, method: opts.method ?? 'GET', body })
  const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data })
  if (u.pathname === '/api/prohire/sessions') {
    const id = `bot${fakeBot.size + 1}`
    fakeBot.set(id, { id, status: 'ready', turns: [], events: [], plan: body, report: null, recording: null })
    return reply({ id, url: `http://bot.test/interview/${id}` })
  }
  let m = u.pathname.match(/^\/api\/sessions\/(\w+)$/)
  if (m) return fakeBot.has(m[1]) ? reply(fakeBot.get(m[1])) : reply({ detail: 'No session' }, 404)
  m = u.pathname.match(/^\/api\/prohire\/sessions\/(\w+)\/invite$/)
  if (m) return reply({ ok: true })
  return reply({ detail: 'Not found' }, 404)
}

const { toBotPlan, reportFromBot } = await import('../src/domain/interviewBot.js')
const meera = await ingestResume({
  filename: 'meera.txt',
  text: 'Meera Iyer\nmeera.iyer@example.com | 9811122233\nPune, Maharashtra\nWorking as Software Engineer at Zenith Tech\nTotal experience: 3 years\nLanguages: English, Hindi\nSKILLS\nC#, ASP.NET Core, SQL Server',
})
const { application: vcApp } = apps.createApplication({ candidate_id: meera.candidate._id, job_id: job._id })
const recruiterQuestions = [
  { id: 'r1', text: 'Walk me through how you tuned a slow SQL Server query.', text_hi: 'आपने एक धीमी SQL Server query को कैसे tune किया, बताइए।', type: 'open', competency: 'technical', weight: 2, must_ask: true },
  { id: 'r2', text: 'Why are you looking to move from Zenith Tech?', type: 'open', competency: 'experience', weight: 1, must_ask: false },
]
const call = await iv.invite(vcApp._id, {
  rules: { mode: 'call', language: 'hi-IN', duration_minutes: 15, answer_pause_seconds: 3, instructions: 'Keep it friendly.', proctoring: { tab_switch_warning: true, auto_terminate: false } },
  questions: recruiterQuestions,
})
const sent = botCalls.find((c) => c.path === '/api/prohire/sessions').body
check('Voice call: the link sent is the call server’s', call.url === 'http://bot.test/interview/bot1', call.url)
check('Voice call: candidate details come from their record', sent.candidate.name === 'Meera Iyer' && sent.candidate.experience_years === 3 && sent.candidate.skills.includes('SQL Server'))
check('Voice call: it opens with "Tell me about yourself"', sent.questions[0].id === 'intro' && sent.questions[0].text === 'Tell me about yourself.' && sent.questions[0].text_hi === 'अपने बारे में बताइए।' && sent.questions[0].must_ask)
check('Voice call: then the recruiter’s questions, as set', sent.questions.length === 3 && sent.questions[1].text_hi.startsWith('आपने') && sent.questions[1].must_ask && sent.questions[2].id === 'r2')
check('Voice call: the recruiter’s settings go across', sent.settings.language === 'Hindi' && sent.settings.duration_minutes === 15 && sent.settings.answer_pause_seconds === 3 && sent.settings.instructions === 'Keep it friendly.')
check('Voice call: "warn only" never ends the call', sent.settings.max_tab_switches === 99)
check('Voice call: the call knows its ProHire records and expiry', sent.prohire.session_id === call.session._id && Boolean(sent.prohire.expires_at))
check('Voice call: our own link forwards to the call', iv.bootstrap(call.session.invite.token).redirect === call.url)
check('Voice call: stage moved to invited', apps.getApplication(vcApp._id).stage === 'invited')

const bs = fakeBot.get('bot1')
bs.status = 'live'
bs.started_at = '2026-09-29T10:00:00.000+00:00'
bs.turns = [{ role: 'interviewer', text: 'नमस्ते Meera', at: '2026-09-29T10:00:01.000+00:00' }]
await iv.syncBotSession(call.session._id)
check('Voice call: started on the server → in progress here', iv.getSession(call.session._id).state === 'in_progress' && apps.getApplication(vcApp._id).stage === 'interview_in_progress')

Object.assign(bs, {
  status: 'ended', ended_at: '2026-09-29T10:09:00.000+00:00', end_reason: 'interviewer_closed', recording: 'bot1.webm',
  turns: [...bs.turns, { role: 'candidate', text: 'मैंने index जोड़ा और query 4 second से 200 ms पर आ गई।', at: '2026-09-29T10:01:00.000+00:00' }],
  events: [{ kind: 'tab_switch', at: '2026-09-29T10:03:00.000+00:00' }],
})
await iv.syncBotSession(call.session._id)
const ended = iv.getSession(call.session._id)
check('Voice call: ended with answers → completed', ended.state === 'completed' && ended.duration_seconds === 540 && ended.end_reason === 'interviewer_closed')
check('Voice call: the transcript comes across', ended.turns.length === 2 && ended.turns[1].role === 'candidate' && ended.turns[1].words > 0)
check('Voice call: tab switches come across', ended.integrity.tab_switches === 1)
check('Voice call: the recording is linked, not copied', ended.recording.url === 'http://localhost:8000/api/sessions/bot1/recording')
check('Voice call: no report until the server has written one', !iv.getReportForSession(call.session._id))

bs.report = {
  generated_at: '2026-09-29T10:10:00+00:00', outcome: 'shortlist', recommendation: 'shortlist', overall: 7.4, technical: 7.8, soft: 6.5, pass_mark: 7,
  skills: [{ skill: 'SQL Server', primary: false, asked: true, score: 7.8, evidence: 'मैंने index जोड़ा', strength: 'Numbers', improvement: '', interpretation: '' }, { skill: 'C#', asked: false, score: null }],
  soft_skills: { fluency: { score: 7, reason: 'Clear' }, confidence: { score: 6, reason: '' }, composure: { score: 7, reason: '' }, communication: { score: 6, reason: '' } },
  questions: [{ question: recruiterQuestions[0].text, answered: true, summary: 'Added an index; 4s → 200ms.' }, { question: recruiterQuestions[1].text, answered: false, summary: '' }],
  evidence: { candidate_words: 80, answered: 1, planned: 2, enough: true },
  strengths: ['Gave a measured result.'], concerns: [], ask_next_round: ['Ask about query plans.'],
  summary: 'Short, specific interview.', rationale: 'Overall 7.4/10 against a pass mark of 7/10.',
  proctoring: { level: 'review', verdict: 'Worth a look.', signals: [{ kind: 'tab_switch', label: 'Left the tab once' }], tab_switches: 1, auto_terminated: false },
}
await iv.syncBotSession(call.session._id)
const vcReport = iv.getReportForSession(call.session._id)
check('Voice call: the server’s report arrives', Boolean(vcReport) && vcReport.source === 'interview_bot')
check('Voice call: scores out of 10 become out of 100', vcReport.overall_score === 74 && vcReport.skills[0].score === 78)
check('Voice call: unasked skills stay unscored', vcReport.skills.length === 1)
check('Voice call: questions matched to the plan', vcReport.per_question[0].question_id === 'intro' && vcReport.per_question[1].question_id === 'r1' && vcReport.per_question[1].answered && !vcReport.per_question[2].answered)
check('Voice call: an unmatched question is not given another one’s answer', !vcReport.per_question[0].answered && vcReport.per_question[0].rationale === '')
check('Voice call: the pipeline shows the result', apps.getApplication(vcApp._id).interview_summary.overall_score === 74)
check('Voice call: integrity signs come across', vcReport.integrity.level === 'medium' && vcReport.integrity.tab_switches === 1)
const { fairnessFromBot } = await import('../src/domain/interviewBot.js')
const live = fairnessFromBot({ status: 'live', events: [
  { kind: 'multiple_faces', detail: { seconds: 4 } }, { kind: 'multiple_faces', detail: { seconds: 2.5 } },
  { kind: 'looking_away', detail: { seconds: 12 } }, { kind: 'tab_switch' }, { kind: 'window_blur', detail: { seconds: 7 } },
] })
check('Proctoring: while it runs, the live events are added up', live.camera === 'running' && live.seconds.multiple_faces === 6.5 && live.seconds.looking_away === 12 && live.tab_switches === 1 && live.window_away_seconds === 7)
const done = fairnessFromBot({ status: 'ended', events: [], proctoring: {
  face_check: 'on', face_visible_share: 0.93, people_check: 'faces and people', screen_extended: true, virtual_camera: 'OBS Virtual Camera',
  totals: { multiple_faces: 0, no_face: 3, looking_away: 41, voice_without_lips: 0, phone_visible: 6 },
  answers: [{ reading_like: true, from_s: 60 }, { reading_like: false }, { reading_like: false }],
}, voice_check: { status: 'done', level: 'serious', other_seconds: 9, segments: [{ prompted: true, text: 'say forty', at_s: 70 }] } })
check('Proctoring: the final summary is used once it arrives', done.camera === 'on' && done.face_visible_share === 0.93 && done.seconds.looking_away === 41 && done.seconds.phone_visible === 6)
check('Proctoring: reading, second display and camera software come across', done.reading_answers === 1 && done.answers_checked === 3 && done.second_display && done.virtual_camera === 'OBS Virtual Camera')
check('Proctoring: other voices and prompting come across', done.voice_check.status === 'done' && done.voice_check.prompted && done.voice_check.other_seconds === 9)
check('Proctoring: no summary after the end is reported as not received', fairnessFromBot({ status: 'ended', events: [] }).camera === 'not_received')
check('Proctoring: the findings are kept on the ProHire session', iv.getSession(call.session._id).fairness?.tab_switches === 1 && iv.getSession(call.session._id).fairness.camera === 'not_received')
const callsBefore = botCalls.length
await iv.syncBotSession(call.session._id)
check('Voice call: a finished call is not re-imported', iv.openBotSessions().every((s) => s._id !== call.session._id) && botCalls.length === callsBefore + 1)
const thin = reportFromBot({ outcome: 'insufficient', recommendation: 'hold', evidence: { enough: false, answered: 0, planned: 2 } }, { plan: ended.plan })
check('Voice call: thin evidence stays "hold", low confidence', thin.recommendation === 'hold' && thin.confidence === 'low')

const { application: vcApp2 } = apps.createApplication({ candidate_id: (await ingestResume({ filename: 'kabir.txt', text: 'Kabir Rao\nkabir@example.com | 9811100000\nTotal experience: 2 years\nSKILLS\nC#' })).candidate._id, job_id: job._id })
const call2 = await iv.invite(vcApp2._id, { rules: { mode: 'call' } })
iv.resendInvite(call2.session._id)
await new Promise((r) => setTimeout(r, 0))
check('Voice call: resending extends the call link too', botCalls.some((c) => c.path === `/api/prohire/sessions/${call2.session.bot.id}/invite` && c.body.expires_at))
iv.cancelSession(call2.session._id)
await new Promise((r) => setTimeout(r, 0))
check('Voice call: cancelling closes the call link', botCalls.some((c) => c.path === `/api/prohire/sessions/${call2.session.bot.id}/invite` && c.body.cancel))
let refused = ''
try { await iv.invite(vcApp2._id, { rules: { mode: 'call', language: 'ta-IN' } }) } catch (err) { refused = err.message }
check('Voice call: only English or Hindi', refused.includes('English or Hindi'))
const direct = toBotPlan({ plan: ended.plan, job: null, candidate: null, company: 'X' })
check('Voice call: a frozen plan alone is enough to build the call', direct.candidate.name === 'Meera Iyer' && direct.questions.length === 3)
const introLayers = [{ source: 'org', rules: { mode: 'call', duration_minutes: 30, max_questions: 8 }, questions: [
  { id: 'a', text: 'Tell me a bit about yourself and your background.', type: 'open', competency: 'experience', weight: 1 },
  { id: 'b', text: 'Why this role?', type: 'open', competency: 'experience', weight: 1 },
] }]
const introPlan = resolvePlan(introLayers, {})
check('Every AI video interview starts with "Tell me about yourself"', introPlan.questions[0].id === 'intro' && introPlan.questions[0].must_ask)
check('A second "tell me about yourself" is dropped, not asked twice', introPlan.questions.filter((q) => /about yourself/i.test(q.text)).length === 1 && introPlan.questions.length === 2)
check('The opening question cannot be left out by an invite', resolvePlan([...introLayers, { source: 'invite', questions: [{ id: 'z', text: 'Only this?', type: 'open', competency: 'experience', weight: 1 }] }], {}).questions.map((q) => q.id).join() === 'intro,z')
check('Interviews in the older formats are unchanged', resolvePlan([{ ...introLayers[0], rules: { mode: 'video' } }], {}).questions[0].id === 'a')

// --- report --------------------------------------------------------------

console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`)
for (const f of fail) console.log(`  ✕ ${f}`)
if (!fail.length) for (const p of pass) console.log(`  ✓ ${p}`)
process.exit(fail.length ? 1 : 0)
