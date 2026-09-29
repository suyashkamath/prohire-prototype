"""Is anyone else talking? The candidate's microphone, checked after the interview.

During the interview the server saves exactly what the candidate's microphone
sent (data/recordings/<id>-mic.wav). Afterwards Sarvam's batch speech-to-text
separates the speakers in it (diarization). The candidate is the one who talks
most; anyone else heard on their microphone is reported with the time and what
they said:

  · another voice for a few seconds      → "review" (listen to the recording)
  · another voice, and then the candidate
    says the same words                  → "prompting" — someone is feeding answers

The interviewer's own voice leaking from the speakers into the microphone is not
another person: a segment that repeats what the interviewer said is ignored.
Diarization can split one voice into two, so none of this is a verdict — it
points the recruiter to the moment to listen to.

analyse() is pure (easy to test); run() calls Sarvam and saves the result.
"""

import asyncio
import json
import logging
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path

from . import sessions

log = logging.getLogger("interviewbot.voice_check")

MODEL = os.getenv("SARVAM_DIARIZE_MODEL", "saaras:v3")
LANGUAGE_CODE = {"English": "en-IN", "Hindi": "hi-IN"}
MIN_SEGMENT = 0.8        # seconds; shorter is a cough, a click or a mis-split
REVIEW_SECONDS = 3.0     # another voice for at least this long in total is worth a listen
ECHO_OVERLAP = 0.6       # this share of a segment's words said by the interviewer = speaker echo
PROMPT_WINDOW = 25.0     # seconds after another voice in which the candidate may repeat it
PROMPT_OVERLAP = 0.5     # … this share of its words, and at least PROMPT_MIN_WORDS of them
PROMPT_MIN_WORDS = 3


def enabled() -> bool:
    return os.getenv("SARVAM_VOICE_CHECK", "on").strip().lower() not in ("off", "0", "false", "no")


def _words(text: str) -> list[str]:
    # Words of 3+ letters ("the", "है" say nothing about who is speaking), and
    # every number: "40 agents" fed to a candidate is the clearest sign of all.
    return [w for w in re.findall(r"[\wऀ-ॿ]+", str(text).lower()) if len(w) >= 3 or w.isdigit()]


def _overlap(part: list[str], whole: set[str]) -> float:
    return sum(1 for w in part if w in whole) / len(part) if part else 0.0


def _offset(session: dict, iso: str | None) -> float:
    """Seconds from the start of the interview to `iso`."""
    try:
        return (datetime.fromisoformat(iso) - datetime.fromisoformat(session["started_at"])).total_seconds()
    except (TypeError, ValueError, KeyError):
        return 0.0


def analyse(entries: list[dict], session: dict) -> dict:
    """Turn a diarized transcript of the candidate's microphone into findings."""
    segs = []
    for e in entries:
        try:
            start, end = float(e["start_time_seconds"]), float(e["end_time_seconds"])
        except (KeyError, TypeError, ValueError):
            continue
        if end - start > 0:
            segs.append({"speaker": str(e.get("speaker_id", "0")), "start": start, "end": end, "text": str(e.get("transcript", "")).strip()})

    talk = {}
    for s in segs:
        talk[s["speaker"]] = talk.get(s["speaker"], 0.0) + s["end"] - s["start"]
    if not talk:
        return {"status": "done", "speakers": 0, "candidate_seconds": 0, "other_seconds": 0, "segments": [], "level": "none"}
    main = max(talk, key=talk.get)

    interviewer = set(_words(" ".join(t["text"] for t in session.get("turns", []) if t["role"] == "interviewer")))
    mic_offset = _offset(session, session.get("mic_started_at"))   # the mic starts a moment after the interview

    others = []
    for s in segs:
        if s["speaker"] == main or s["end"] - s["start"] < MIN_SEGMENT:
            continue
        words = _words(s["text"])
        if words and _overlap(words, interviewer) >= ECHO_OVERLAP:
            continue                                   # the interviewer, leaking from the speakers
        later = " ".join(m["text"] for m in segs if m["speaker"] == main and s["end"] <= m["start"] <= s["end"] + PROMPT_WINDOW)
        repeated = [w for w in words if w in set(_words(later))]
        prompted = len(repeated) >= PROMPT_MIN_WORDS and _overlap(words, set(repeated)) >= PROMPT_OVERLAP
        others.append({
            "speaker": s["speaker"],
            "at_s": round(mic_offset + s["start"], 1),
            "seconds": round(s["end"] - s["start"], 1),
            "text": s["text"][:200],
            "prompted": prompted,
        })

    other_seconds = round(sum(o["seconds"] for o in others), 1)
    level = "serious" if any(o["prompted"] for o in others) else "review" if other_seconds >= REVIEW_SECONDS else "none"
    return {
        "status": "done",
        "speakers": 1 + len({o["speaker"] for o in others}),   # the candidate + other voices heard
        "candidate_seconds": round(talk[main], 1),
        "other_seconds": other_seconds,
        "segments": sorted(others, key=lambda o: (not o["prompted"], -o["seconds"]))[:10],
        "level": level,
    }


def _diarize(path: Path, language: str, key: str) -> list[dict]:
    from sarvamai import SarvamAI   # only needed here

    client = SarvamAI(api_subscription_key=key)
    job = client.speech_to_text_job.create_job(
        model=MODEL, mode="transcribe", language_code=LANGUAGE_CODE.get(language, "unknown"), with_diarization=True,
    )
    job.upload_files([str(path)])
    job.start()
    job.wait_until_complete(poll_interval=5, timeout=900)
    if job.is_failed():
        raise RuntimeError("Sarvam could not process the audio.")
    with tempfile.TemporaryDirectory() as out:
        job.download_outputs(out)
        files = list(Path(out).glob("*.json"))
        if not files:
            raise RuntimeError("Sarvam returned no transcript.")
        data = json.loads(files[0].read_text(encoding="utf-8"))
    return (data.get("diarized_transcript") or {}).get("entries") or []


async def run(session_id: str) -> dict:
    """Check the saved microphone for other voices and save the result on the session."""
    session = sessions.get(session_id)
    path = sessions.mic_path(session_id)
    key = (os.getenv("SARVAM_API_KEY") or "").strip()
    if not enabled():
        result = {"status": "off"}
    elif not session.get("mic_audio") or not path.exists() or path.stat().st_size < 16000 * 2:
        result = {"status": "no_audio"}
    elif not key:
        result = {"status": "failed", "error": "SARVAM_API_KEY is not set in .env."}
    else:
        try:
            entries = await asyncio.to_thread(_diarize, path, session["plan"]["settings"].get("language", "English"), key)
            result = analyse(entries, session)
        except Exception as exc:     # network, quota, format — the report says it was not checked
            log.exception("Voice check for %s failed", session_id)
            result = {"status": "failed", "error": str(exc)[:200]}
    result["model"] = MODEL
    sessions.save_voice_check(session_id, result)
    return result
