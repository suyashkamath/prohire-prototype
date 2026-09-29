"""Interview settings: stored as data, editable any number of times.

This is the fix for the vendor's biggest limitation. Erika's instructions are
set once per job and then locked. Here every setting lives in a JSON file that
HR can change as often as they like, in layers:

    company defaults  →  job  →  this candidate  →  this interview

Each layer only sets what it changes. `resolve()` combines them into the plan
for one interview. When an interview starts, that plan is frozen into the
session, so editing a job later changes the NEXT interview, never one that has
already happened.

Every save keeps the previous version in data/history/.
"""

import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .settings import DATA

COMPANY_FILE = DATA / "company.json"
JOBS = DATA / "jobs"
CANDIDATES = DATA / "candidates"
HISTORY = DATA / "history"

# Only these can be set per job, per candidate or per interview.
SETTING_KEYS = {
    "language",               # "English" or "Hindi"
    "strictness",             # "lenient" | "moderate" | "strict"
    "duration_minutes",
    "max_questions",
    "follow_ups_per_question",
    "interviewer_name",
    "instructions",           # free-text guidance for the interviewer
    "voice_speaker",          # Sarvam speaker name; empty = the agent's own voice
    "max_tab_switches",
    "answer_pause_seconds",   # silence that ends an answer; shorter pauses are the candidate thinking
}

LANGUAGES = ("English", "Hindi")
STRICTNESS = {
    "lenient": "Be encouraging. Ask a follow-up only if an answer is very short or off-topic.",
    "moderate": "Ask one follow-up when an answer is vague or has no concrete example.",
    "strict": "Probe for specifics: ask one follow-up whenever an answer lacks numbers, results or the candidate's own part.",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, doc: dict, kind: str) -> dict:
    """Save a document, keeping the version it replaces."""
    previous = _read(path) if path.exists() else None
    doc = copy.deepcopy(doc)
    doc["version"] = (previous or {}).get("version", 0) + 1
    doc["updated_at"] = _now()
    if previous:
        HISTORY.mkdir(parents=True, exist_ok=True)
        (HISTORY / f"{kind}-{path.stem}-v{previous.get('version', 0)}.json").write_text(
            json.dumps(previous, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return doc


def _clean_settings(raw: dict | None) -> dict:
    """Keep known setting keys with a value; empty means 'inherit'."""
    out = {}
    for key, value in (raw or {}).items():
        if key not in SETTING_KEYS or value in (None, ""):
            continue
        if key == "language" and value not in LANGUAGES:
            raise ValueError(f"Language must be one of {', '.join(LANGUAGES)}.")
        if key == "strictness" and value not in STRICTNESS:
            raise ValueError(f"Strictness must be one of {', '.join(STRICTNESS)}.")
        if key in {"duration_minutes", "max_questions", "follow_ups_per_question", "max_tab_switches"}:
            value = int(value)
            if value < 0:
                raise ValueError(f"{key} cannot be negative.")
        if key == "answer_pause_seconds":
            value = float(value)
            if not 1 <= value <= 8:
                raise ValueError("The answer pause must be between 1 and 8 seconds.")
        out[key] = value
    return out


# --- reading and saving ---------------------------------------------------------

def company() -> dict:
    return _read(COMPANY_FILE)


def save_company(doc: dict) -> dict:
    current = company()
    current["name"] = doc.get("name", current.get("name"))
    current["settings"] = {**current.get("settings", {}), **_clean_settings(doc.get("settings"))}
    return _write(COMPANY_FILE, current, "company")


def list_jobs() -> list[dict]:
    return [_read(p) for p in sorted(JOBS.glob("*.json"))]


def job(job_id: str) -> dict:
    path = JOBS / f"{job_id}.json"
    if not path.exists():
        raise KeyError(f"No job '{job_id}'.")
    return _read(path)


def _clean_questions(questions: list[dict]) -> list[dict]:
    out = []
    for i, q in enumerate(questions or []):
        text = (q.get("text") or "").strip()
        if not text:
            continue
        out.append({
            "id": q.get("id") or f"q{i + 1}",
            "text": text,
            "text_hi": (q.get("text_hi") or "").strip(),
            "must_ask": bool(q.get("must_ask")),
            "skill": q.get("skill") or None,
        })
    return out


def save_job(job_id: str, doc: dict) -> dict:
    current = job(job_id)
    interview = current.setdefault("interview", {})
    if "questions" in doc:
        interview["questions"] = _clean_questions(doc["questions"])
    if "settings" in doc:
        interview["settings"] = _clean_settings(doc["settings"])
    return _write(JOBS / f"{job_id}.json", current, "job")


def list_candidates() -> list[dict]:
    return [_read(p) for p in sorted(CANDIDATES.glob("*.json"))]


def candidate(candidate_id: str) -> dict:
    path = CANDIDATES / f"{candidate_id}.json"
    if not path.exists():
        raise KeyError(f"No candidate '{candidate_id}'.")
    return _read(path)


def save_candidate(candidate_id: str, doc: dict) -> dict:
    current = candidate(candidate_id)
    if "overrides" in doc:
        current["overrides"] = _clean_settings(doc["overrides"])
    if "extra_questions" in doc:
        current["extra_questions"] = _clean_questions(doc["extra_questions"])
    return _write(CANDIDATES / f"{candidate_id}.json", current, "candidate")


# --- combining the layers ---------------------------------------------------------

def resolve(job_id: str, candidate_id: str, interview_overrides: dict | None = None) -> dict[str, Any]:
    """The plan for one interview: every layer combined, nothing saved."""
    comp, jb, cand = company(), job(job_id), candidate(candidate_id)
    layers = [
        ("company", comp.get("settings", {})),
        ("job", jb.get("interview", {}).get("settings", {})),
        ("candidate", cand.get("overrides", {})),
        ("interview", _clean_settings(interview_overrides)),
    ]
    settings: dict[str, Any] = {}
    came_from: dict[str, str] = {}
    for layer, values in layers:
        for key, value in values.items():
            settings[key] = value
            came_from[key] = layer

    # Job questions, then this candidate's own; "always ask" first, then the
    # rest, up to the question limit.
    pool = jb.get("interview", {}).get("questions", []) + cand.get("extra_questions", [])
    must = [q for q in pool if q.get("must_ask")]
    rest = [q for q in pool if not q.get("must_ask")]
    limit = int(settings.get("max_questions") or len(pool))
    chosen = (must + rest)[: max(limit, len(must))]
    # Keep the job's own order for the chosen questions.
    order = {q["id"]: i for i, q in enumerate(pool)}
    chosen.sort(key=lambda q: order[q["id"]])

    hindi = settings.get("language") == "Hindi"
    questions = []
    for q in chosen:
        asked = q["text_hi"] if hindi and q.get("text_hi") else q["text"]
        questions.append({**q, "asked_as": asked, "in_english_only": hindi and not q.get("text_hi")})

    return {
        "job": {k: jb.get(k) for k in ("id", "reference", "title", "department", "location", "skills_required", "primary_skill", "primary_skill_min_years", "experience")},
        "candidate": {k: cand.get(k) for k in ("id", "name", "reference", "experience_years", "current", "location", "skills", "languages")},
        "company": comp.get("name", "Probus Insurance"),
        "settings": settings,
        "settings_from": came_from,
        "questions": questions,
        "versions": {"company": comp.get("version", 0), "job": jb.get("version", 0), "candidate": cand.get("version", 0)},
    }


# Used by bot/prohire.py for plans that come from ProHire rather than data/.
clean_settings = _clean_settings
clean_questions = _clean_questions
