# ProHire v2 — prototype

In-house ATS + AI interviewer for Probus HR. Browser-only prototype: no server
yet. Everything (including interview videos) is saved in the browser.

Full build notes: [`docs/prohire-v2-prototype.md`](../docs/prohire-v2-prototype.md).

```bash
npm install
npm run dev      # http://localhost:5173 — sign in with any name
npm test         # service-level end-to-end checks
```

First run: **Dashboard → Load demo data** (fictional sales/insurance and IT jobs).

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
- A real LLM and neural Indian-language voices. The prototype uses the browser's voices and a local scoring heuristic.
- Bulk AI phone screening (IVR) and WhatsApp bot: future enhancement.
