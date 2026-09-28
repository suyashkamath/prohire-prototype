# ProHire v2 — prototype

In-house ATS + AI interviewer for Probus HR. Prototype: data (including
interview videos) is saved in the browser. The only server code is a small
Vite plugin that lets the live AI interviewer use OpenAI without exposing the key.

Full build notes: [`docs/prohire-v2-prototype.md`](../docs/prohire-v2-prototype.md).

```bash
npm install
cp .env.example .env   # then put your OpenAI key in OPENAI_API_KEY
npm run dev            # http://localhost:5173 — sign in with any name
npm test               # service-level end-to-end checks
```

First run: **Dashboard → Load demo data** (fictional sales/insurance and IT jobs).

## The live AI interviewer (OpenAI)

With `OPENAI_API_KEY` set, **video** and **voice** interviews are a live,
spoken conversation with Aarya: she greets the candidate, asks each question,
listens, asks a follow-up when an answer is vague, and closes the interview —
in the candidate's language (Hinglish and other code-mixing is fine).

| Piece | OpenAI | Where |
|---|---|---|
| The conversation (speech ↔ speech) | Realtime API over WebRTC, `gpt-realtime` | `src/interview/realtime.js`, `src/interview/LiveSession.jsx` |
| Live captions + transcript of the candidate | `gpt-4o-mini-transcribe` | same session |
| Interviewer instructions, guardrails, strictness | — | `src/domain/interviewerPrompt.js` |
| 60-second key, so `OPENAI_API_KEY` never reaches the browser | `/v1/realtime/client_secrets` | `server/realtime.js` (Vite plugin) |

The model never sees the question list: it calls a `next_question` tool, which
reads the session cursor. So progress, resume after a reload or dropped
connection, and "which answer belongs to which question" are exact, and the
session document is the same one the typed flow writes — scoring, the report,
the recording and the recruiter screens work unchanged. The recording has both
voices mixed in.

**Try it:** Load demo data → a job → ⋯ on a candidate → *Send AI interview*
(format Video or Voice) → open the link in the same browser. Use headphones.

Without a key, or if the live connection fails twice, the page falls back to
the original flow (browser voice reads the questions; the candidate speaks or
types) and continues at the same question. Voice: Settings → *Live interviewer voice*.

Model overrides in `.env`: `OPENAI_REALTIME_MODEL`, `OPENAI_TRANSCRIBE_MODEL`.

## What HR asked for, and where it is

| Requirement | Where |
|---|---|
| Departments; every job tagged to one; unique job ID (`SLS-0004`) | Departments, Jobs |
| Job status: draft / active / on hold / closed / cancelled; edit a job any time | Job page → status, **Edit job** |
| Job published on the **official** career page; its applicants arrive in the job, tagged *Career portal* | Job → Job description → *Where this job is advertised*; contract in [`docs/career-portal-integration.md`](../docs/career-portal-integration.md); Settings → Official career page |
| Add candidates 4 ways: enter details, upload resume, from database, LinkedIn/Naukri | Job → **Add candidates** |
| Chrome extension for LinkedIn and Naukri (reads the Resdex card: exp, CTC, location, current/previous, education, pref. locations, key skills) | `chrome-extension/` (see its README) |
| Resume bank (ATS) with Naukri-style keyword search, filters, card view, candidate IDs (`CAN-00012`), Excel export | Candidates |
| Per-candidate actions: stage, interest email, AI interview, note, tags, flag, share profile, download resume, DPDP consent, move to another job, withdraw, reject, remove, delete | "⋯" menu on every candidate |
| Stages end at *Selected → Darwin* (offer/BGV/onboarding stay in Darwin) | Pipeline |
| AI interviewer with our own name (default **Aarya**, not Erica) and Indian-English voice | Settings → AI interviewer's name |
| 10 languages: English (India), Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Punjabi, Bengali | Invite dialog, Interview setup |
| **Per-candidate** interview settings: language, format, strictness, length, light mode, questions. Nothing is locked after first setup | Invite dialog ("These settings apply to this candidate only") |
| Questionnaire only / AI interview only / both; questions with flag-if answers | Job → Interview setup |
| Unlimited skills, a primary skill and its minimum years | New / Edit job |
| Video + audio recording with download, jump to each question | Report → Recording |
| Tab-switch warnings (3) then auto-end; pasted answers and face checks noted | Job → Interview setup → Cheating checks; report → Integrity |
| Report: why recommended, per-skill scores, fluency/confidence/clarity, questionnaire, Q&A, CV; share link; PDF | Interviews → report |
| Editable email templates (subject, CC, body); send via mail app or WhatsApp | Settings → Email templates; every send |

## Not in the prototype (needs the backend)

- Real email sending, the career-page API endpoints, LinkedIn job posting.
- Server storage of resumes and recordings. They stay in the browser that made them.
- PDF/DOCX resume text extraction. Paste the text for now.
- An LLM for question generation and scoring. Those still use the local heuristic in `domain/ai.js` (same return shapes, ready to swap). The interview itself is live OpenAI when a key is set.
- The live interviewer's plan is posted by the page (there is no server-side session store yet); the server builds the prompt from it and never accepts a prompt from the page.
- Bulk AI phone screening (IVR) and WhatsApp bot: future enhancement.
