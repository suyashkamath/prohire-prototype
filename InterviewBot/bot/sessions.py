"""One interview = one session file in data/sessions/.

A session holds the plan frozen at start, every turn of the conversation with
its time, the integrity events (tab switches), and where the recording is.
"""

import json
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path

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


def add_turn(session_id: str, role: str, text: str) -> dict:
    turn = {"role": role, "text": text, "at": _now()}
    _update(session_id, lambda doc: doc["turns"].append(turn))
    return turn


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


def save_recording(session_id: str, data: bytes, suffix: str = ".webm") -> str:
    get(session_id)
    RECORDINGS.mkdir(parents=True, exist_ok=True)
    name = f"{session_id}{suffix}"
    (RECORDINGS / name).write_bytes(data)
    _update(session_id, lambda doc: doc.__setitem__("recording", name))
    return name
