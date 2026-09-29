"""One interview = one session file in data/sessions/.

A session holds the plan frozen at start, every turn of the conversation with
its time, the integrity events (tab switches, faces, voices…), and where the
recordings are: the video, and the candidate's microphone on its own (for the
check for other voices — see voice_check).
"""

import json
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path

from . import turns as turns_mod
from .settings import DATA

SESSIONS = DATA / "sessions"
RECORDINGS = DATA / "recordings"
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _path(session_id: str) -> Path:
    if not session_id.isalnum():
        raise KeyError("Bad session id.")
    return SESSIONS / f"{session_id}.json"


def get(session_id: str) -> dict:
    path = _path(session_id)
    if not path.exists():
        raise KeyError(f"No session '{session_id}'.")
    return json.loads(path.read_text(encoding="utf-8"))


def _save(doc: dict) -> dict:
    SESSIONS.mkdir(parents=True, exist_ok=True)
    _path(doc["id"]).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return doc


def _update(session_id: str, change) -> dict:
    with _lock:
        doc = get(session_id)
        change(doc)
        return _save(doc)


def create(plan: dict) -> dict:
    return _save({
        "id": secrets.token_hex(8),
        "created_at": _now(),
        "status": "ready",            # ready → live → ended
        "plan": plan,                 # frozen: later edits to settings don't touch it
        "interaction_id": None,
        "started_at": None,
        "ended_at": None,
        "end_reason": None,
        "turns": [],
        "events": [],
        "results": {},                # what the agent reported (ratings, CTC, disposition…)
        "results_raw": [],            # the agent's update messages as received, for checking
        "recording": None,
        "mic_audio": None,            # the candidate's microphone alone, as heard by the server
        "mic_started_at": None,
        "answers": [],                # when each answer started and ended (from the answer gate)
        "proctoring": None,           # the browser's camera summary (see web/proctor.js)
        "voice_check": None,          # other voices on the microphone (see voice_check)
    })


def list_all() -> list[dict]:
    rows = [json.loads(p.read_text(encoding="utf-8")) for p in SESSIONS.glob("*.json")] if SESSIONS.exists() else []
    return sorted(rows, key=lambda s: s["created_at"], reverse=True)


def mark_live(session_id: str, interaction_id: str | None) -> dict:
    def change(doc):
        doc["status"] = "live"
        doc["started_at"] = doc["started_at"] or _now()
        doc["interaction_id"] = interaction_id or doc["interaction_id"]
    return _update(session_id, change)


def add_turn(session_id: str, role: str, text: str) -> dict | None:
    """Add a turn. Returns it (with "replace": True when it replaced the last
    turn), or None when there was nothing new to add.

    A candidate answer that Sarvam sends again, carried on, is merged instead of
    kept twice (see turns.continuation).
    """
    out = {}

    def change(doc):
        turns = doc["turns"]
        turn = {"role": role, "text": text, "at": _now()}
        last_answer = next((t for t in reversed(turns) if t["role"] == "candidate"), None)
        extra = turns_mod.continuation(last_answer["text"], text) if role == "candidate" and last_answer else None
        if extra is not None and turns[-1] is last_answer:
            last_answer["text"] = text                      # the same answer, carried on
            out["turn"] = {**last_answer, "replace": True}
            return
        if extra == "":
            return                                          # said again, nothing new
        if extra:
            turn["text"] = extra                            # carried on after the interviewer spoke
        turns.append(turn)
        out["turn"] = turn
    _update(session_id, change)
    return out.get("turn")


def add_event(session_id: str, kind: str, detail: dict | None = None) -> int:
    """Record an event; returns how many of this kind so far."""
    counted = {}

    def change(doc):
        doc["events"].append({"kind": kind, "at": _now(), **({"detail": detail} if detail else {})})
        counted["n"] = sum(1 for e in doc["events"] if e["kind"] == kind)
    _update(session_id, change)
    return counted["n"]


def merge_results(session_id: str, values: dict, raw: dict | None = None) -> dict:
    """Keep the agent's latest non-empty value for each result."""
    def change(doc):
        results = doc.setdefault("results", {})
        for key, value in values.items():
            if value not in (None, ""):
                results[key] = value
        if raw is not None:
            doc.setdefault("results_raw", []).append({"at": _now(), **raw})
    return _update(session_id, change)


def end(session_id: str, reason: str) -> dict:
    def change(doc):
        if doc["status"] == "ended":
            return
        doc["status"] = "ended"
        doc["ended_at"] = _now()
        doc["end_reason"] = reason
    return _update(session_id, change)


def save_report(session_id: str, report: dict) -> dict:
    return _update(session_id, lambda doc: doc.__setitem__("report", report))


def save_recording(session_id: str, data: bytes, suffix: str = ".webm") -> str:
    get(session_id)
    RECORDINGS.mkdir(parents=True, exist_ok=True)
    name = f"{session_id}{suffix}"
    (RECORDINGS / name).write_bytes(data)
    _update(session_id, lambda doc: doc.__setitem__("recording", name))
    return name


def mic_path(session_id: str) -> Path:
    _path(session_id)                   # checks the id
    return RECORDINGS / f"{session_id}-mic.wav"


def mark_mic(session_id: str) -> dict:
    """The candidate's microphone is being saved from now on."""
    def change(doc):
        doc["mic_audio"] = mic_path(session_id).name
        doc["mic_started_at"] = doc.get("mic_started_at") or _now()
    return _update(session_id, change)


def add_answer(session_id: str, started_at: str, seconds: float) -> dict:
    return _update(session_id, lambda doc: doc.setdefault("answers", []).append(
        {"started_at": started_at, "ended_at": _now(), "seconds": round(seconds, 1)}))


def save_proctoring(session_id: str, summary: dict) -> dict:
    return _update(session_id, lambda doc: doc.__setitem__("proctoring", {**summary, "received_at": _now()}))


def save_voice_check(session_id: str, result: dict) -> dict:
    return _update(session_id, lambda doc: doc.__setitem__("voice_check", result))


def set_expiry(session_id: str, expires_at: str) -> dict:
    """ProHire resent the invite: the link is good for longer."""
    return _update(session_id, lambda doc: doc["plan"].setdefault("prohire", {}).__setitem__("expires_at", expires_at))


def add_email(session_id: str, to: str, cc: str, subject: str) -> dict:
    """Keep a note of each invite email sent for this interview (not its body)."""
    entry = {"at": _now(), "to": to, "cc": cc, "subject": subject}
    return _update(session_id, lambda doc: doc.setdefault("emails", []).append(entry))


def now() -> str:
    return _now()
