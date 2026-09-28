# ProHire InterviewBot

The ProHire AI interview, built separately on a **Sarvam voice agent**, so it can
be tested before it is plugged into ProHire. It uses the same jobs, candidates and
questions as the ProHire prototype (exported from it into `data/`).

```
Candidate's browser ──WebSocket──▶ this server (holds the keys) ──▶ Sarvam voice agent
   mic 16 kHz PCM, camera            passes audio both ways,          listens, thinks,
   recording, tab-switch checks      saves the transcript             speaks (Aarya)
```

## Every setting is editable, any number of times

This is the fix for Erika's "set once" instructions. Settings are data, in layers:

| Layer | Where | Edited on |
|---|---|---|
| Company defaults | `data/company.json` | `PUT /api/company` |
| Job | `data/jobs/<job>.json` | Settings page → *Job settings* |
| This candidate | `data/candidates/<candidate>.json` | Settings page → *This candidate only* |

Each save gets a new version; the old one is kept in `data/history/`. When an
interview starts, the combined settings are **frozen** into it, so later edits
change the next interview, never one already done.

## Setup (once)

```bash
cd InterviewBot
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env
```

Fill in `.env` from the Sarvam Agents dashboard (agents.sarvam.ai):
`INTERVIEW_BOT_API_KEY` (the **agent's** API key, not the general Sarvam key), `SARVAM_ORG_ID`, `SARVAM_WORKSPACE_ID`, `AGENT_ID`.
`.env` is git-ignored — never commit it.

Check the key and IDs (no call is made):

```bash
.venv\Scripts\python check_sarvam.py
```

## Set up the agent in the Sarvam dashboard

The agent only uses a variable that is **defined in its Variables section and used
in its instruction**. Anything else the bot sends is ignored, and the agent falls
back to its own fixed script — which is exactly the vendor's "set once" problem.

**Your agent already has** (checked on 28 Sep 2026):

| Kind | Variables |
|---|---|
| Inputs the bot fills | `candidate_name`, `role_applied`, `company_name`, `resume_summary` |
| Results the agent fills during the call (saved to the session) | `interview_disposition`, `experience_rating`, `communication_rating`, `salary_fit_rating`, `notice_period_fit_rating`, `notice_period`, `current_ctc`, `expected_ctc`, `call_summary` |
| ⚠ Remove | `gender` (default "male"). Gender must never influence an evaluation. |

1. **Add** these variables so the settings page actually changes the interview:
   `interviewer_name, interview_language, strictness, strictness_rule, duration_minutes,
   follow_ups_per_question, question_count, questions, primary_skill, key_skills, extra_instructions`
2. Use them in the agent's **instruction** instead of fixed text, for example:

```
You are {{interviewer_name}}, an AI interviewer for {{company_name}}. You are interviewing
{{candidate_name}} ({{resume_summary}}) for the role of {{role_applied}}.
Speak in {{interview_language}}, in a warm, professional Indian-English or Hindi tone.

Ask these {{question_count}} questions in this order, one at a time:
{{questions}}

Rules:
- Ask at most {{follow_ups_per_question}} follow-up per question. {{strictness_rule}}
- Never repeat a question the candidate has already answered.
- Never ask about age, marriage, family, religion, caste, health, gender or politics.
- Do not tell the candidate whether they passed. A recruiter decides.
- Keep to about {{duration_minutes}} minutes. After the last question, thank them and end.
{{extra_instructions}}
```

(Check Sarvam's exact variable syntax in its docs; `{{name}}` is shown as an example.)

The greeting, the starting language (English or Hindi), key terms for the speech
recogniser (the job's skills) and, optionally, the voice are sent per interview too.

## Run

```bash
.venv\Scripts\python -m uvicorn main:app --reload --port 8000
```

- `http://localhost:8000` — settings: pick a job and candidate, edit, **Preview**, **Start interview**
- the interview opens in a new tab (use Chrome; allow camera and microphone)
- *Past interviews* → **open** shows the transcript, events and recording

## Tests (no Sarvam call)

```bash
.venv\Scripts\python tests\test_bot.py
```

## Not built yet

Scoring and the report (next step: send the saved transcript and a rubric to an LLM
and return the ProHire report shape), resuming after a dropped connection, and a
login for the settings page. This is a local prototype: run it on your own machine.
