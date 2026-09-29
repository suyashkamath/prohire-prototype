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
- Keep to about {{duration_minutes}} minutes. After the last question, thank them and end the call.
- You end the interview, not the candidate. If they ask to stop early, confirm once, thank them and end the call.
{{extra_instructions}}
```

**Only the interviewer ends the interview.** The candidate's page has no end button.
When the agent says its closing line ("…सारे सवाल पूरे हो गए हैं…", "That brings us to
the end of the interview…"), the server ends the interview as soon as that line has been
spoken, even if the agent doesn't hang up (`turns.is_closing` in `bot/turns.py`; the exact
line is sent to the agent in `extra_instructions`). It also ends when the agent hangs up,
when the tab is left too many times, or at the planned duration plus 5 minutes
(`GRACE_MINUTES` in `bot/bridge.py`).

**The candidate can finish long answers.** Sarvam's agent replies at the first short
pause, so the server does not give it the answer until it is finished. While the candidate
speaks, their audio is held on the server; once the silence reaches the *Pause that ends
an answer* setting (2.5 s by default, 1–8 s, per job or per candidate), the whole answer is
sent in one go and the agent replies. Shorter pauses to think or breathe do not end the
answer. (`AnswerGate` in `bot/turns.py`; each answer sent is logged with its loudness.) Raise the setting for candidates who think aloud slowly;
lower it if the interviewer feels slow to respond.

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

## Sending interviews from ProHire

The usual way in. In the ProHire console (`prohire-v2`, `npm run dev`), open a job,
and on a candidate's row press **Interview**. The dialog opens on **AI voice call**:

- the candidate's details (name, role, experience, location, skills, languages) come
  from their ProHire profile — nothing to type;
- the recruiter sets the language (English or Hindi), strictness, length, follow-ups,
  the pause that ends an answer, what happens on leaving the tab, instructions for the
  interviewer, and the questions (edit, add, remove, reorder, "always ask", Hindi version);
- **Create interview & email the link** freezes that plan, creates the call here
  (`POST /api/prohire/sessions`), and opens the invite email addressed to the candidate.
  **Send email** sends it from the HR mailbox (`SMTP_*` in `.env`); without SMTP, **Open in
  mail app** sends it from the recruiter's own mailbox. Nothing opens the interview for the
  recruiter.

While the ProHire console is open it checks each open call every 15 seconds
(`GET /api/sessions/{id}`) and brings back the state, transcript, tab switches, the
recording link and — when it is written — this server's report, shown in ProHire's own
report page. Resending or cancelling in ProHire extends or closes the link here
(`POST /api/prohire/sessions/{id}/invite`), and an expired link is refused.

For ProHire to reach this server, set in `.env`: `PROHIRE_ORIGINS` (where the console runs;
default `http://localhost:5173`) and, for candidates on other machines, `PUBLIC_URL` (the
address they open). ProHire's own setting is **Settings → AI voice interview → Server
address** (default `http://localhost:8000`).

## Fairness checks (proctoring)

| Sign | How it is found | Where |
|---|---|---|
| Another person on camera | face landmarker + person detector (MediaPipe, in the candidate's browser, CPU) | `web/proctor.js` |
| Out of view, looking away a lot | face and head direction against the candidate's own first seconds | `web/proctor.js` |
| Reading answers out | eyes sweep along a line and jump back, again and again, while answering | `web/proctor.js` |
| A voice while the lips are still | microphone loudness + lip movement | `web/proctor.js` |
| A phone in view | person/phone detector, once a second | `web/proctor.js` |
| Another window in front, tab left, second display, virtual camera | browser events | `web/interview.js` |
| Someone else talking or feeding answers | the candidate's microphone is saved on its own and split by speaker with Sarvam batch speech-to-text after the interview; another voice whose words the candidate then repeats = prompting | `bot/voice_check.py` |
| Memorised, generic or inconsistent answers | the report model, with the candidate's exact words as proof; the agent asks for a specific example when an answer sounds read out | `bot/report.py` |

`bot/integrity.py` puts them together as **review** (worth a look) or **serious**
(another person for 5 s+, someone feeding answers, ended for leaving the tab).
They never change a score; a serious sign turns "Recommended" into "Hold". Every
sign has times that jump the video there on the review page. Short moments are
ignored, a poor camera is reported as a camera problem, and a "person" there all
interview is treated as a poster. No pictures or face data leave the browser.

Limits: a candidate who knows how can switch the browser checks off, so treat
"no signs" as "nothing found", not proof. Whispering and a helper off camera who
stays silent are not caught. Check the thresholds on real interviews with
different lighting, skin tones, glasses and cameras before relying on them.
`SARVAM_VOICE_CHECK=off` in `.env` skips the voice check.

## Tests (no Sarvam call)

```bash
.venv\Scripts\python tests\test_bot.py
```

## Not built yet

Resuming after a dropped connection (closing the tab currently ends the
interview), and a login for the settings page. This is a local prototype: run it on your own machine.
