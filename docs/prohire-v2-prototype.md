# ProHire v2 — prototype build notes

> **Companion to** [prohire-ats-system-design.md](prohire-ats-system-design.md) and
> [end-to-end-flow.md](end-to-end-flow.md). Those describe the target system.
> This one records **what the working prototype in `prohire-v2/` actually does**,
> why each piece exists, and what is still missing.
> **Date:** 25 September 2026

---

## 0. Where this came from

HR walked through the vendor portal currently in use (a paid ATS with the "Erica"
AI interviewer) and listed what Probus needs from an in-house replacement. The
recurring complaint was **rigidity**: interview setup is one-time per job, so two
candidates on the same job cannot get a different language, questions or
difficulty, and every change needs a vendor ticket. Management also found Erica's
American-English accent hard to follow.

The brief, in short:

1. An **AI interviewer** with our own name and an Indian voice, in English, Hindi
   and regional languages, **configured per candidate**, with video that can be
   downloaded.
2. An **ATS / resume bank**: departments, jobs with unique IDs, candidates from
   LinkedIn, Naukri, uploads and the official career page, searchable later.
3. **User friendly**: a colleague must be able to run it without help, and
   anything configurable must stay editable.

Offer letters, BGV, onboarding and separation stay in **Darwin**; ProHire ends
when a candidate is selected.

---

## 1. Running it

```bash
cd prohire-v2
npm install
npm run dev      # http://localhost:5173 — sign in with any name
npm test         # 146 end-to-end service checks
npm run lint
```

First run: **Dashboard → Load demo data**. It creates fictional sales/insurance and
IT jobs, a Naukri-imported candidate and a career-page applicant, all run through
the real pipeline.

The prototype has **no server**. Data lives in the browser's `localStorage`;
interview recordings live in IndexedDB. Clearing site data erases everything, so
use Settings → Export JSON for backups.

---

## 2. Requirement → feature map

| HR asked for | What was built | Where in the app |
|---|---|---|
| Create departments; tag every job to one | Departments with a code; a job cannot exist without one | Departments |
| Every job has a unique ID | `{DEPT}-{SEQ}` e.g. `SLS-0004`; never changes, even if the job is edited | Jobs |
| Active / inactive, hold, closed, draft, cancelled | Five statuses; draft is invisible everywhere | Job page → status |
| Edit anything, no one-time setup | Full **Edit job** form; interview setup editable at any time; per-candidate overrides at invite time | Job page |
| Jobs on the official career page; applicants show up here | "List on the official career page" toggle feeds the official site; its applications land in the job's pipeline tagged **Career portal** (see §5) | Job → Job description |
| LinkedIn posting | Toggle recorded; posting itself needs the backend integration | Job → Job description |
| Naukri posting | Not possible (Naukri's API is paid); profiles are pulled in with the extension instead | — |
| Add candidates 4 ways | **Enter details**, **Upload resume**, **From database**, **LinkedIn / Naukri** | Job → Add candidates |
| Chrome extension for LinkedIn and Naukri | `chrome-extension/` (MV3). Reads the profile, or the selected Resdex card, and opens ProHire's import page | §6 |
| Resume bank, searchable like Naukri | Candidate database with multi-keyword search (every word must match across name, ID, phone, skills, city, role, full resume text), filters, and a Naukri-style **card view** | Candidates |
| Candidates have IDs too | `CAN-00012` | Everywhere |
| Pipeline row shows contact, location, primary skill, key skills, who added, source, stage | Yes | Job → Pipeline |
| Actions: change status, reject, withdraw, tag, edit, view, flag, engage, delete, download, move, consent, notes, share, assessment | All on the **⋯** menu of every candidate, in the pipeline and on the profile | ⋯ menu |
| Optional "are you interested?" email before the interview | "Ask if interested (email)" → one-click Yes / Not right now page | ⋯ menu |
| DPDP consent (optional) | "Request data consent (DPDP)" → consent page; status shown on the profile. Career-page applicants consent when they apply | ⋯ menu |
| Excel export | CSV with BOM (opens cleanly in Excel, keeps Hindi/Tamil/₹) from the database and from each pipeline | Export to Excel |
| Stages: sourcing, screening, interview; not offer/hire | Stages end at **Selected → Darwin**; offered/hired/declined removed; **Withdrawn** added | Pipeline |
| AI suggestions of suitable CVs (like Naukri) | Match % against the JD, as a **suggestion only**; nobody is rejected automatically | Pipeline → ✦ AI suggestions |
| Our own interviewer name, not Erica | Default **Aarya**, editable in Settings; old "Erika/Erica" values are migrated | Settings |
| Indian English, proper Hindi, regional languages | 10 languages: English (India), Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Punjabi, Bengali. Questions spoken with the browser's `xx-IN` voice; answers by voice (speech-to-text) or typing | Invite dialog |
| Per-candidate interview: language, mode, questions | Every setting is per candidate at invite time; the job only provides defaults | Invite dialog |
| Lenient / moderate / strict | Kept; moves the rubric and the pass mark together | Invite dialog, Interview setup |
| More than 5 skills; a primary skill and its minimum experience | Unlimited key skills; primary skill + min years on the job; the primary skill is asked first and scored separately | New / Edit job |
| Qualification only / AI interview / both | **Questionnaire only**, **AI interview only**, **Questionnaire + AI interview**. Questionnaire has yes/no, number, text and choice questions with "flag if" rules | Interview setup |
| Up to 10 custom questions, or AI asks from JD + resume | No limit on custom questions; with none, questions are generated from the JD and the resume | Interview setup |
| Light mode = 15 minutes | Kept (15 min, max 5 questions) | Invite dialog |
| Invite email with subject, CC, instructions, link | Editable templates; compose box before every send; send via mail app or **WhatsApp** | Settings → Email templates |
| Tab switch: 3 warnings, then auto-terminate | Warning modal on each departure; ends on the 4th. Limit and behaviour configurable per job or candidate. Paste events and (in Chrome) face-missing / second-face events also logged with timestamps | Interview setup → Cheating checks |
| Report: recommendation, primary-skill scores, fluency / communication / confidence, violations, reason, Q&A with video, CV | All present; plus questionnaire answers and "ask in the next round" | Interviews → report |
| Download the video | **Download video** button; "▶ Watch from mm:ss" per question | Report → Recording |
| Share / download the report | No-login share link; **Download PDF** (print) | Report |

**Deliberately left out** (HR said it is not needed, or it lives in Darwin):
screening as a gate, submission stage, offers, onboarding, manpower budgeting,
agency and employee portals, and referrals as a separate portal (a referral is a
source on manual entry).

**Future enhancements** mentioned in the walkthrough, not built: bulk AI phone
screening (IVR calling thousands of applicants with a script) and a WhatsApp
screening bot.

---

## 3. The recruiter's day, end to end

```
Department ─▶ Job (ID, status, JD, skills, primary skill, publish)
                 │
                 ├─ official career page ──▶ applications arrive (Career portal)
                 ├─ Chrome extension ──────▶ LinkedIn / Naukri profiles
                 ├─ upload / enter details / from database
                 ▼
            Pipeline  ── optional: interest email ──▶ Yes / Not right now
                 │
                 ├─ ⋯ Send AI interview  (per-candidate settings) ─▶ email / WhatsApp
                 ▼
     Candidate: welcome → consent → device check → [questionnaire] → [interview] → done
                 │
                 ▼
            Report ─▶ recruiter decides: Shortlist / Hold / Reject
                 │
                 ▼
          Face-to-face round ─▶ Selected → Darwin
```

The system never moves a stage on its own. The only automatic stage changes are
facts: the interview started, it finished, or the candidate answered the interest
email.

---

## 4. The candidate's side

The link opens without login. The screens, in order:

1. **Welcome.** Job, company, length, question count, language and format. It
   says plainly that the interviewer is an AI and that a person decides.
2. **Consent.** What is recorded (video and audio, or a transcript), who sees it,
   180-day retention under DPDP, not used for AI training. Declining is not a
   rejection.
3. **Device check.** Connection, saving, whether the browser has a voice for the
   chosen language, then camera and microphone. A candidate whose camera will not
   start can continue without it, and the report says so.
4. **Questionnaire** (if chosen). One short form, phone-friendly.
5. **Interview** (if chosen). Aarya reads each question aloud (🔊 Repeat
   available). The candidate presses 🎤 Speak or types. At most one follow-up per
   question, depending on strictness. A self-view shows ● REC while recording.
   Leaving the tab shows "Warning n of 3"; past the limit the interview ends.
6. **Done.** Or "Your interview has ended" if it was auto-terminated.

Closing the tab mid-interview resumes at the same question. The recording then
continues as a second part.

---

## 5. Official career page integration

ProHire **does not host a career page**. The official site keeps its own design
and connects in two places:

- `GET /api/v1/career-portal/jobs`: jobs that are active and marked for the
  career page.
- `POST /api/v1/career-portal/applications`: one call per application, with the
  resume file.

Full field list, responses and fallback: **[career-portal-integration.md](career-portal-integration.md)**.
Give that file to whoever runs the official site. The key is generated in
Settings → Official career page.

In the prototype the intake is `applyToJob()` in
`prohire-v2/src/services/careers.js`. **Job → Job description → Test: simulate an
application** calls the same function, so dedupe, consent capture and the
"Career portal" tag can be demonstrated before the backend exists.

---

## 6. Chrome extension (LinkedIn / Naukri)

`prohire-v2/chrome-extension/`. Install with chrome://extensions → Developer
mode → Load unpacked. Instructions are in its README.

- **LinkedIn profile:** click the extension → Send profile.
- **Naukri Resdex search results:** select one candidate's card, then click the
  extension. Only the selection is sent.
- It opens ProHire's `/import` page with the data in the URL **fragment**
  (`#…`), which browsers never send to a server.

The import page parses the Naukri card by its labels
(`src/domain/portalProfile.js`):

| Card shows | Becomes |
|---|---|
| `6y 0m` | 6 years' experience |
| `₹ 7.30 Lacs` | Current CTC 7.3 LPA |
| `Raipur` | City + state |
| Current / Previous `Sales Officer at Parle …` | Title and company |
| Education, Pref. locations | Stored as-is |
| Key skills `A \| B \| C`, May also know | Skills. The first key skill is the primary. Items Naukri truncates with `…` are dropped |

Naukri and LinkedIn hide phone and email until revealed, so the import page warns
when they are missing. If the email or phone matches someone already in ProHire,
the record is updated rather than duplicated.

---

## 7. How the prototype is built

Same layering as V1: **screens → services → domain / db**. A screen never touches
`db` directly.

```
prohire-v2/src/
├── domain/            pure logic, no I/O
│   ├── resolvePlan.js     layered interview config: org → dept → job → candidate → invite
│   ├── qualification.js   questionnaire defaults + knockout evaluation
│   ├── portalProfile.js   Naukri / LinkedIn card parser
│   ├── emailTemplates.js  default templates, {{placeholders}}, mailto
│   ├── ai.js              local heuristic: screening, question generation, follow-ups, scoring,
│   │                      per-skill scores, fluency / confidence / clarity
│   ├── locations.js       states & cities, 10 languages, source channels, job statuses
│   └── stages.js          pipeline stages (ends at Selected → Darwin)
├── services/          business rules over the db
│   ├── jobs.js            create / edit / publish / career-page feed
│   ├── candidates.js      ingest, dedupe, search, IDs, flag, tags, consent, delete
│   ├── applications.js    stages, notes, interest check, move / remove
│   ├── interviews.js      templates, invite (freeze), conduct, integrity log, reports
│   ├── careers.js         career-page intake + Chrome-extension import
│   └── core.js            settings, email templates, activity log, sign-in
├── lib/               db.js (localStorage), media.js (IndexedDB recordings), csv.js
├── interview/         candidate surface: App.jsx, media.js (TTS, STT, recorder, face checks),
│                      InterestPage, ConsentPage, SharedReport
├── components/        ReportView, RecordingPlayer, EmailCompose, Brand (logo + Aarya orb), ui/
└── console/           recruiter screens
    └── features/
        ├── jobs/          JobsPage, NewJob (create + edit), JobDetail, Pipeline, AddCandidates,
        │                  InterviewSetup, InviteDialog, CareerPortalTest
        ├── candidates/    CandidatesPage, CandidateCard, CandidateDetail, ManualEntry, UploadDialog,
        │                  ImportPage, useCandidateActions + CandidateActions (the ⋯ menu)
        ├── interviews/    InterviewsPage, SessionDetail
        └── settings/      SettingsPage (defaults, email templates, career-page key, backup)
```

### Per-candidate configuration, without cloning jobs

Interview settings are a stack of sparse patches:

```
company default → department → job → this candidate → this invite
```

Each layer sets only what it changes. At invite time the stack is flattened and
**frozen** into the session. That is why editing a job tomorrow does not change
yesterday's report, and why two candidates on one job can be interviewed in
different languages with different questions. The vendor portal could not do
this.

### Data added in this build

| Where | Field | Purpose |
|---|---|---|
| `jobs` | `primary_skill`, `primary_skill_min_years` | Interview focus |
| `jobs` | `publish { career_portal, linkedin, published_at }` | Advertising |
| `jobs` | `status: 'draft'` | Not yet visible |
| `candidates` | `reference` (`CAN-00001`) | Readable ID |
| `candidates` | `location`, `primary_skill`, `preferred_locations` | Pipeline and search |
| `candidates` | `flag { reason, by, at }`, `tags[]` | Recruiter marks |
| `candidates` | `consent { data_processing, token, captured_at }` | DPDP |
| `interview_templates` | `qualification[]` | Questionnaire, with `knockout` rules |
| plan `rules` | `mode` (video / voice / text), `assessment_type`, `proctoring { max_tab_switches, auto_terminate, paste_detection, face_presence }` | Interview behaviour |
| `interview_sessions` | `violations[] { kind, at, question_index }`, `qualification_answers`, `recording` meta | Integrity log, answers, video |
| `interview_reports` | `skills[]`, `communication`, `qualification`, `integrity`, `recommendation_reason` | New report sections |
| `settings` | `email_templates`, `career_portal_key` | Editable wording, integration |

Older data keeps working. Missing fields fall back to defaults. This was
checked against a browser holding pre-build data.

---

## 8. Bugs found and fixed along the way

1. **Lost writes across tabs.** Each tab kept its own in-memory copy of the
   database and wrote it back whole. With the console and a candidate's interview
   open in the same browser (the normal demo setup), the staler tab silently
   overwrote the other's data. It also happened after a hot reload. **Fix:** one
   shared cache per page, dropped whenever another tab writes (`storage` event).
2. **Every uploaded resume was recorded as "Added manually".**
   `createCandidate(input, { source })` was called with the source object itself.
   **Fix:** accept both shapes. Covered by a test.

---

## 9. Not in the prototype (needs the backend)

| Missing | Why | Next step |
|---|---|---|
| Real email sending | No server | Send from the HR mailbox; the compose box stays the same |
| Career-page API endpoints | No server | Implement §5 exactly as specified |
| LinkedIn job posting | Needs LinkedIn partner API | Backend integration |
| Server storage of resumes and recordings | Browser-only | Object storage; recordings stream in chunks |
| PDF / DOCX text extraction | Needs `pdfplumber` / `python-docx` | Reuse the V1 backend extractor |
| Real LLM for questions and scoring | Prototype uses a deterministic heuristic | Swap `domain/ai.js` for model calls (same return shapes) |
| Neural Indian voices | Browser voices vary by device | TTS/STT provider with `xx-IN` voices; the `speech` code per language is already there |
| Face checks outside Chrome | Uses the browser's `FaceDetector` | Server-side or WASM face detection |
| Real authentication and roles | Name-only sign-in | SSO / login with recruiter roles |

---

## 10. Testing

`npm test` runs `prohire-v2/scripts/e2e.mjs` against a `localStorage` shim: 146
checks. The 50 added in this build cover:

- The Naukri card parser, field by field (including dropping truncated skills).
- Portal import: candidate, source, card fields, IDs, dedupe.
- Career-page intake: lands in the job, tagged, consent recorded, refused without
  consent, no duplicate on re-apply.
- Keyword search: multi-word matching and search by candidate ID.
- Ten languages, with Indian English first.
- Questionnaire-only sessions: no score, knockouts flagged, knockouts give "hold".
- Knockout rules never reach the candidate's page.
- Combined sessions: sales questions for sales jobs, primary skill asked first.
- Tab switches logged with timestamps; auto-termination recorded and never "recommended".
- Per-skill and communication scores, and the recommendation reason.
- Move to job, flag, and delete (including sessions).
- Template placeholders.

These flows were also exercised by hand in Chrome:

- Job pipeline and the ⋯ menu.
- Per-candidate invite and email compose.
- Candidate link: voice, questionnaire, tab-switch warning, auto-termination.
- Live update of the recruiter tab from the candidate tab.
- Report.
- Extension import of a Naukri card.
- Card view in the candidate database.
