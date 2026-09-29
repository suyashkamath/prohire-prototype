"""The interview report — built from the candidate's own answers only.

An LLM (Sarvam-105B) reads the transcript and the interview plan and writes
observations: a score and a verbatim quote per skill, the four soft skills,
strengths, concerns and a summary. It does NOT decide anything. This module
then applies the rules in code:

  · totals follow from their parts: technical = average of the skills that were
    actually asked; soft = average of fluency, confidence, composure, communication;
  · a quote is kept only if those exact words are in what the candidate said;
  · a skill nobody asked about is "not asked" and never lowers the score;
  · too little answered → "not enough evidence", never an automatic reject;
  · the recommendation comes from the scores and the pass mark for the chosen
    strictness — not from the model's opinion;
  · an interview ended for leaving the tab, or with another serious sign of
    unfair means (see integrity), can never be "recommended".

The agent's own ratings (its result variables) are deliberately not used here.
"""

import json
import logging
import os
import re
from datetime import datetime, timezone

import httpx

from . import integrity, sessions, voice_check

log = logging.getLogger("interviewbot.report")

CHAT_URL = "https://api.sarvam.ai/v1/chat/completions"
MODEL = os.getenv("SARVAM_REPORT_MODEL", "sarvam-105b")
PASS_MARK = {"lenient": 6.0, "moderate": 7.0, "strict": 8.0}   # out of 10
MIN_WORDS = 60            # fewer words than this from the candidate is not enough to judge
MIN_ANSWERED_SHARE = 0.5  # nor is answering fewer than half the questions
SOFT = ("fluency", "confidence", "composure", "communication")

SYSTEM = """You evaluate job interviews for {company}. You receive the job, the planned questions and the transcript.

Judge ONLY what the candidate actually said. Rules:
- Base every score on the candidate's own words. Quote evidence VERBATIM from the candidate's lines (copy exact words).
- A skill counts as asked only if the interviewer asked about it or the candidate talked about it. Otherwise asked=false and score=null.
- Never let gender, age, religion, caste, marital status, family, health, accent, or the language the candidate chose (Hindi or English) affect anything. Answering in Hindi is exactly as good as answering in English.
- Scores are 0-10: 0-2 no evidence, 3-4 basic, 5-6 relevant but thin, 7-8 specific with examples, 9-10 exceptional with numbers and results.
- Write all text in English. Be specific and brief.
Return ONLY a JSON object with exactly these keys:
{{
 "skills": [{{"skill": "<one of the job skills>", "asked": true|false, "score": 0-10 or null, "evidence": "<verbatim candidate quote or empty>", "strength": "<one line>", "improvement": "<one line>", "interpretation": "<one line>"}}],
 "soft_skills": {{"fluency": {{"score": 0-10, "reason": "<one line>"}}, "confidence": {{...}}, "composure": {{...}}, "communication": {{...}}}},
 "questions": [{{"question": "<planned question>", "answered": true|false, "summary": "<what the candidate said, one line>"}}],
 "strengths": ["<one line>"],
 "concerns": ["<one line>"],
 "ask_next_round": ["<one question for the human round>"],
 "summary": "<3-5 sentences on how the interview went, based on the answers>",
 "observations": ["<evidence-based point for the recruiter>"],
 "integrity_signs": [{{"kind": "memorised|generic|outside_help|inconsistent", "quote": "<verbatim candidate words>", "why": "<one line>"}}]
}}
integrity_signs is usually empty. Add one ONLY with a verbatim quote and a clear reason:
- memorised: reads like written text said aloud (a definition, a list, textbook phrasing) AND the candidate could not add anything of their own when asked to go further.
- generic: a stock answer with nothing from their own work even after a follow-up asked for an example.
- outside_help: a sudden jump in knowledge or fluency against their other answers, or they answer a different question from the one asked, as if repeating something.
- inconsistent: facts that contradict what they said earlier (years, numbers, employers).
Being fluent, well prepared, confident, or speaking good English or Hindi is NOT a sign. Pausing to think is NOT a sign."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _norm(text: str) -> str:
    return re.sub(r"[\s‌‍]+", " ", str(text)).strip().lower()


def _clamp(value, lo=0.0, hi=10.0):
    try:
        return round(max(lo, min(hi, float(value))), 1)
    except (TypeError, ValueError):
        return None


def _avg(values):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 1) if values else None


def _transcript_text(session: dict) -> str:
    who = {"candidate": "CANDIDATE", "interviewer": "INTERVIEWER"}
    return "\n".join(f"{who.get(t['role'], t['role'].upper())}: {t['text']}" for t in session["turns"])


def _prompt(session: dict) -> list[dict]:
    plan = session["plan"]
    job = plan["job"]
    skills = [s for s in [job.get("primary_skill"), *(job.get("skills_required") or [])] if s]
    skills = list(dict.fromkeys(skills))
    user = (
        f"JOB: {job['title']} ({job.get('reference', '')})\n"
        f"PRIMARY SKILL: {job.get('primary_skill') or '-'}\n"
        f"JOB SKILLS: {', '.join(skills)}\n"
        f"INTERVIEW LANGUAGE: {plan['settings'].get('language', 'English')}\n\n"
        "PLANNED QUESTIONS:\n" + "\n".join(f"{i + 1}. {q['text']}" for i, q in enumerate(plan["questions"])) +
        "\n\nTRANSCRIPT:\n" + _transcript_text(session)
    )
    return [
        {"role": "system", "content": SYSTEM.format(company=plan.get("company", "the company"))},
        {"role": "user", "content": user},
    ]


async def _ask_model(messages: list[dict]) -> dict:
    key = (os.getenv("SARVAM_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("SARVAM_API_KEY is not set in .env (the general Sarvam key is used for the report).")
    # Sarvam-105B thinks before it answers, and the thinking counts against
    # max_tokens. Low effort plus a large budget leaves room for the JSON; if it
    # still runs out, try once more with an even larger budget.
    content, finish = None, None
    for budget in (12000, 20000):
        body = {
            "model": MODEL, "messages": messages, "temperature": 0, "max_tokens": budget,
            "reasoning_effort": "low", "response_format": {"type": "json_object"},
        }
        async with httpx.AsyncClient(timeout=240) as client:
            r = await client.post(CHAT_URL, json=body, headers={"api-subscription-key": key})
        r.raise_for_status()
        choice = r.json()["choices"][0]
        content, finish = choice["message"].get("content"), choice.get("finish_reason")
        if content:
            break
    if not content:
        raise RuntimeError(f"The model returned no answer (finish_reason={finish}).")
    content = re.sub(r"^```(?:json)?|```$", "", content.strip()).strip()
    return json.loads(content)


def build(session: dict, model_out: dict | None, error: str | None = None) -> dict:
    """Apply the rules to the model's observations. Pure: easy to test."""
    plan = session["plan"]
    job = plan["job"]
    settings = plan["settings"]
    candidate_lines = [t["text"] for t in session["turns"] if t["role"] == "candidate"]
    candidate_text = _norm(" ".join(candidate_lines))
    words = len(" ".join(candidate_lines).split())
    out = model_out or {}

    # Skills: only the job's own, in the job's order; unknown names are ignored.
    skill_names = list(dict.fromkeys(s for s in [job.get("primary_skill"), *(job.get("skills_required") or [])] if s))
    by_name = {str(s.get("skill", "")).strip().lower(): s for s in out.get("skills", []) if isinstance(s, dict)}
    skills = []
    for name in skill_names:
        s = by_name.get(name.lower(), {})
        asked = bool(s.get("asked")) and _clamp(s.get("score")) is not None
        quote = str(s.get("evidence") or "").strip().strip('"“”')
        verbatim = bool(quote) and _norm(quote) in candidate_text
        skills.append({
            "skill": name,
            "primary": name == job.get("primary_skill"),
            "asked": asked,
            "score": _clamp(s.get("score")) if asked else None,
            "evidence": quote if verbatim else "",
            "strength": (s.get("strength") or "").strip() if asked else "",
            "improvement": (s.get("improvement") or "").strip() if asked else "",
            "interpretation": (s.get("interpretation") or "").strip() if asked else "",
        })

    soft_in = out.get("soft_skills") or {}
    soft = {k: {"score": _clamp((soft_in.get(k) or {}).get("score")), "reason": ((soft_in.get(k) or {}).get("reason") or "").strip()} for k in SOFT}
    if words == 0:
        soft = {k: {"score": None, "reason": "The candidate did not speak."} for k in SOFT}

    technical = _avg([s["score"] for s in skills])
    soft_score = _avg([v["score"] for v in soft.values()])
    parts = [x for x in (technical, soft_score) if x is not None]
    overall = round(0.7 * technical + 0.3 * soft_score, 1) if len(parts) == 2 else (parts[0] if parts else None)

    questions = [q for q in out.get("questions", []) if isinstance(q, dict)]
    planned = len(plan["questions"])
    answered = sum(1 for q in questions if q.get("answered")) if questions else 0
    share = (answered / planned) if planned else 0
    enough = words >= MIN_WORDS and share >= MIN_ANSWERED_SHARE and overall is not None and not error

    strictness = settings.get("strictness", "moderate")
    pass_mark = PASS_MARK.get(strictness, 7.0)
    # Signs of unfair means, with the model's quotes checked like the skills' are.
    signs = []
    for sign in out.get("integrity_signs") or []:
        if not isinstance(sign, dict) or sign.get("kind") not in integrity.MODEL_KINDS:
            continue
        quote = str(sign.get("quote") or "").strip().strip('"“”')
        if quote and _norm(quote) in candidate_text:
            signs.append({"kind": sign["kind"], "quote": quote, "why": str(sign.get("why") or "").strip()})
    fair = integrity.assess(session, signs)
    serious = fair["level"] == "serious"

    if not enough:
        outcome = "insufficient"
        recommendation = "hold"
    elif overall >= pass_mark:
        outcome = recommendation = "shortlist"
    elif overall >= pass_mark - 1.0:
        outcome = recommendation = "hold"
    else:
        outcome = recommendation = "reject"
    if serious and recommendation == "shortlist":
        outcome = recommendation = "hold"

    reason = []
    if error:
        reason.append(f"AI scoring was not available ({error}), so this report is incomplete.")
    elif not enough:
        reason.append(f"The candidate said about {words} words and answered {answered} of {planned} questions — not enough evidence to recommend or reject. Speak to them before deciding.")
    else:
        reason.append(f"Overall {overall}/10 (technical {technical}/10, soft skills {soft_score}/10) against a pass mark of {pass_mark}/10 for {strictness} interviews.")
    if fair["auto_terminated"]:
        reason.append("The interview was ended automatically after the tab was left too many times.")
    if serious:
        reason.append("There are serious signs of unfair means, so this is not a recommendation until someone has watched the video.")
    elif fair["level"] == "review":
        reason.append("Some moments are worth checking in the video (see Proctoring).")

    def lines(key):
        return [str(x).strip() for x in out.get(key, []) if str(x).strip()][:5]

    return {
        "generated_at": _now(),
        "method": "llm" if model_out and not error else "none",
        "model": MODEL if model_out else None,
        "outcome": outcome,                      # shortlist | hold | reject | insufficient
        "recommendation": recommendation,        # never "reject" when evidence is thin
        "overall": overall,
        "pass_mark": pass_mark,
        "technical": technical,
        "soft": soft_score,
        "soft_skills": soft,
        "skills": skills,
        "questions": questions[:planned + 5],
        "evidence": {"candidate_words": words, "answered": answered, "planned": planned, "enough": enough},
        "strengths": lines("strengths"),
        "concerns": lines("concerns"),
        "ask_next_round": lines("ask_next_round"),
        "summary": (out.get("summary") or "").strip(),
        "observations": lines("observations"),
        "rationale": " ".join(reason),
        "proctoring": fair,                      # see integrity.assess
        "error": error,
    }


async def generate(session_id: str) -> dict:
    """Score a session from its transcript and save the report on it."""
    session = sessions.get(session_id)
    # Other voices on the microphone: checked once (again if it failed before).
    if (session.get("voice_check") or {}).get("status") in (None, "failed") and session.get("mic_audio"):
        await voice_check.run(session_id)
        session = sessions.get(session_id)
    words = sum(len(t["text"].split()) for t in session["turns"] if t["role"] == "candidate")
    model_out, error = None, None
    if words:
        try:
            model_out = await _ask_model(_prompt(session))
        except Exception as exc:   # network, quota, bad JSON — the report says so
            log.exception("Report for %s failed", session_id)
            error = str(exc)[:200]
    report = build(session, model_out, error)
    sessions.save_report(session_id, report)
    return report
