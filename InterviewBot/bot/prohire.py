"""Interviews set up in ProHire.

ProHire is where recruiters work: it has the candidate, the job and the
recruiter's own choice of questions and settings. This server only runs the
voice call. So ProHire sends the finished plan for one interview (frozen at
the moment the recruiter pressed "send"), this server checks it and makes a
session, and ProHire emails the candidate the link and later reads back the
transcript, report and recording.

Nothing here reads data/jobs or data/candidates: an interview from ProHire
carries everything it needs.

The invite email goes out from the HR mailbox (SMTP_* in .env). If that is not
set up, ProHire falls back to opening the recruiter's own mail app.
"""

import os
import re
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage

from . import config_store

JOB_KEYS = ("id", "reference", "title", "department", "location", "skills_required",
            "primary_skill", "primary_skill_min_years", "experience")
CANDIDATE_KEYS = ("id", "name", "reference", "experience_years", "current", "location", "skills", "languages")
LINK_KEYS = ("session_id", "application_id", "candidate_id", "job_id", "expires_at")
MAX_EMAILS_PER_SESSION = 5
EMAIL_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")


def plan_from(body: dict) -> dict:
    """The bot's plan for one interview, from what ProHire sent. Raises ValueError."""
    job = body.get("job") or {}
    candidate = body.get("candidate") or {}
    if not str(job.get("title") or "").strip():
        raise ValueError("The job has no title.")
    if not str(candidate.get("name") or "").strip():
        raise ValueError("The candidate has no name.")

    settings = config_store.clean_settings(body.get("settings"))
    if settings.get("language") not in (None, *config_store.LANGUAGES):
        raise ValueError("The voice interview runs in English or Hindi.")
    questions = config_store.clean_questions(body.get("questions"))
    if not questions:
        raise ValueError("The interview has no questions.")

    hindi = settings.get("language") == "Hindi"
    return {
        "job": {k: job.get(k) for k in JOB_KEYS},
        "candidate": {k: candidate.get(k) for k in CANDIDATE_KEYS},
        "company": str(body.get("company") or "Probus Insurance"),
        "settings": settings,
        "settings_from": {k: "prohire" for k in settings},
        "questions": [
            {**q, "asked_as": q["text_hi"] if hindi and q["text_hi"] else q["text"],
             "in_english_only": hindi and not q["text_hi"]}
            for q in questions
        ],
        "versions": {},
        # Which ProHire records this interview belongs to, so results can be matched back.
        "prohire": {k: str(v) for k, v in (body.get("prohire") or {}).items() if k in LINK_KEYS and v},
    }


def expired(session: dict) -> bool:
    """ProHire's invite expiry (7 days, extended on resend) applies here too."""
    when = (session.get("plan", {}).get("prohire") or {}).get("expires_at")
    if not when:
        return False
    try:
        return datetime.fromisoformat(when.replace("Z", "+00:00")) < datetime.now(timezone.utc)
    except ValueError:
        return False


# --- the invite email -----------------------------------------------------------------

def email_ready() -> bool:
    return bool(os.getenv("SMTP_HOST") and (os.getenv("SMTP_FROM") or os.getenv("SMTP_USER")))


def check_email(session: dict, to: str, cc: str, subject: str, body: str, link: str) -> list[str]:
    """Who and what may be sent. This server has no login, so it only ever sends
    an invite for an interview ProHire made, carrying that interview's link."""
    to_list = [a.strip() for a in to.split(",") if a.strip()]
    cc_list = [a.strip() for a in cc.split(",") if a.strip()]
    if not session.get("plan", {}).get("prohire"):
        raise ValueError("Only interviews created from ProHire can be emailed from here.")
    if session["status"] == "ended":
        raise ValueError("This interview has already ended.")
    if len(session.get("emails") or []) >= MAX_EMAILS_PER_SESSION:
        raise ValueError(f"This invite has already been emailed {MAX_EMAILS_PER_SESSION} times.")
    if not to_list or len(to_list) + len(cc_list) > 5:
        raise ValueError("Send to one candidate (at most 5 addresses including CC).")
    bad = [a for a in to_list + cc_list if not EMAIL_RE.match(a)]
    if bad:
        raise ValueError(f"Not an email address: {', '.join(bad)}")
    if not subject.strip() or not body.strip():
        raise ValueError("The email needs a subject and a message.")
    if link not in body:
        raise ValueError("The message must include the interview link.")
    return to_list + cc_list


def send_email(to: str, cc: str, subject: str, body: str) -> None:
    """Send one plain-text email through the HR mailbox. Raises on failure."""
    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT") or 587)
    user, password = os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM") or user
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, to, subject
    if cc:
        msg["Cc"] = cc
    msg.set_content(body)
    context = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as smtp:
            if user:
                smtp.login(user, password or "")
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.starttls(context=context)
            if user:
                smtp.login(user, password or "")
            smtp.send_message(msg)
