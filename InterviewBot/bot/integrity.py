"""Was the interview fair? Every sign of help or cheating, in one place.

Sources:
  · the candidate's browser (web/proctor.js): faces on camera — none, more than
    one, turned away — a voice while the candidate's lips are still, eye
    movement like reading, another window in front, the tab left, a second
    display, a virtual camera;
  · the microphone checked for other voices after the interview (voice_check);
  · the report model: answers that sound memorised, generic, or out of step with
    the candidate's other answers (quotes checked to be the candidate's words).

Each sign is "review" (worth a look at the video) or "serious" (hard evidence:
another face for a while, someone feeding answers, ended for leaving the tab).
None of this changes a score. A "serious" sign only stops a "Recommended": the
candidate goes to "Hold" and a person decides after watching. People look away
to think, and cameras miss faces in poor light, so single, short moments are
not reported at all.

assess() is pure: easy to test.
"""

from datetime import datetime

MULTI_FACE_SERIOUS = 5.0      # seconds of a second face in total
NO_FACE_REVIEW = 20.0         # out of view for this long in total
LOOKING_AWAY_REVIEW = 30.0
VOICE_NO_LIPS_REVIEW = 6.0
WINDOW_AWAY_REVIEW = 5.0
POOR_CAMERA_SHARE = 0.5       # face seen in less than half the frames: a camera problem, not cheating
ALWAYS_THERE_SHARE = 0.8      # a second "person" in almost every frame is usually a photo or poster
PHONE_REVIEW = 5.0            # a phone in view for this long in total
MODEL_KINDS = {
    "memorised": "Answer sounds memorised or read out",
    "generic": "Generic answer with nothing from their own work",
    "outside_help": "Answer may have outside help",
    "inconsistent": "Does not match what they said earlier",
}


def _offset(session: dict, iso: str | None) -> float | None:
    try:
        return round((datetime.fromisoformat(iso) - datetime.fromisoformat(session["started_at"])).total_seconds(), 1)
    except (TypeError, ValueError, KeyError):
        return None


def _when(session: dict, event: dict) -> float | None:
    """When an episode began. The browser sends it when it ends, with its length."""
    d = event.get("detail") or {}
    if isinstance(d.get("from_s"), (int, float)):
        return round(float(d["from_s"]), 1)
    at = _offset(session, event.get("at"))
    return None if at is None else round(max(0.0, at - float(d.get("seconds") or 0)), 1)


def _episodes(session: dict, kind: str) -> tuple[float, list[float]]:
    """Total seconds and start times of one kind of episode.

    Episodes arrive live as events; the last ones, ended as the page closed,
    only in the browser's summary. Each is counted once.
    """
    rows = [(_when(session, e), float((e.get("detail") or {}).get("seconds") or 0))
            for e in session.get("events", []) if e.get("kind") == kind]
    for ep in (session.get("proctoring") or {}).get("episodes") or []:
        if ep.get("kind") == kind and isinstance(ep.get("from_s"), (int, float)):
            if not any(t is not None and abs(t - ep["from_s"]) < 1.0 for t, _ in rows):
                rows.append((round(float(ep["from_s"]), 1), float(ep.get("seconds") or 0)))
    total = sum(sec for _, sec in rows)
    return round(total, 1), sorted(t for t, _ in rows if t is not None)


def assess(session: dict, model_signs: list[dict] | None = None) -> dict:
    signals = []

    def add(kind, strength, label, times=(), seconds=None, detail=""):
        signals.append({"kind": kind, "strength": strength, "label": label, "times": list(times)[:8],
                        "seconds": seconds, "detail": detail})

    # The tab and other windows
    tab_count = len([e for e in session.get("events", []) if e.get("kind") == "tab_switch"])
    tab_times = [_offset(session, e.get("at")) for e in session.get("events", []) if e.get("kind") == "tab_switch"]
    auto_ended = session.get("end_reason") == "auto_terminated_tab_switches"
    if auto_ended:
        add("tab_switch", "serious", f"Ended for leaving the interview tab {tab_count} times", tab_times)
    elif tab_count:
        add("tab_switch", "review", f"Left the interview tab {tab_count} time{'s' if tab_count != 1 else ''}", tab_times)
    away, away_times = _episodes(session, "window_blur")
    if away >= WINDOW_AWAY_REVIEW:
        add("window_blur", "review", f"Another window was in front of the interview for {away:.0f} s", away_times, away,
            "Another app had focus while the interview tab stayed open — for example a chat or notes window.")

    # The camera
    p = session.get("proctoring") or {}
    camera = p.get("face_check") or "not_received"
    poor_camera = camera == "on" and (p.get("face_visible_share") is not None) and p["face_visible_share"] < POOR_CAMERA_SHARE

    multi, multi_times = _episodes(session, "multiple_faces")
    always = (p.get("multi_share") or 0) >= ALWAYS_THERE_SHARE
    if multi and always:
        add("multiple_faces", "review", "A second person was in view for almost the whole interview", multi_times[:1], multi,
            "Usually a photo, poster or TV behind the candidate rather than a helper. Check the video once.")
    elif multi:
        add("multiple_faces", "serious" if multi >= MULTI_FACE_SERIOUS else "review",
            f"Another person was on camera for {multi:.0f} s", multi_times, multi,
            "More than one person was seen. Watch the video at these times.")
    phone, phone_times = _episodes(session, "phone_visible")
    if phone >= PHONE_REVIEW:
        add("phone_visible", "review", f"A phone was in view for {phone:.0f} s", phone_times, phone,
            "A phone on the desk is common; one held up while answering is worth a look.")
    none, none_times = _episodes(session, "no_face")
    if poor_camera:
        add("camera", "review", "The camera could not see the candidate clearly for most of the interview",
            detail="Face checks are unreliable here (lighting, angle or camera). This is not a sign of cheating by itself.")
    elif none >= NO_FACE_REVIEW:
        add("no_face", "review", f"The candidate was out of view for {none:.0f} s", none_times, none)
    look, look_times = _episodes(session, "looking_away")
    if look >= LOOKING_AWAY_REVIEW and not poor_camera:
        add("looking_away", "review", f"Looked away from the screen for {look:.0f} s in total", look_times, look,
            "Looking away to think is normal; long or repeated looks in one direction can mean notes or another screen.")
    lips, lips_times = _episodes(session, "voice_without_lips")
    if lips >= VOICE_NO_LIPS_REVIEW and not poor_camera:
        add("voice_without_lips", "review", f"A voice was heard for {lips:.0f} s while the candidate's lips were still", lips_times, lips,
            "Someone else may have been speaking. Listen at these times.")
    reading = [a for a in p.get("answers") or [] if a.get("reading_like")]
    if reading:
        add("reading", "review", f"Eye movement like reading during {len(reading)} answer{'s' if len(reading) != 1 else ''}",
            [a.get("from_s") for a in reading if a.get("from_s") is not None],
            detail="Eyes kept sweeping along a line and jumping back, as when reading text.")
    if p.get("screen_extended"):
        add("second_display", "review", "A second display was connected", detail="Common with a laptop and a monitor; worth a look alongside the other signs.")
    if p.get("virtual_camera"):
        add("virtual_camera", "review", f"The camera was camera software ({p['virtual_camera']})",
            detail="Virtual cameras can show a recorded or edited video instead of the person.")

    # Other voices on the microphone
    v = session.get("voice_check") or {}
    voice = v.get("status") or "not_run"
    if voice == "done" and v.get("level") in ("review", "serious"):
        prompted = [s for s in v.get("segments", []) if s.get("prompted")]
        quote = (prompted or v.get("segments") or [{}])[0].get("text", "")
        add("other_voice", v["level"],
            "Someone may have been telling the candidate what to say" if prompted else f"Another voice was heard for {v.get('other_seconds', 0):.0f} s",
            [s["at_s"] for s in v.get("segments", [])], v.get("other_seconds"),
            (f'Heard: "{quote}"' + (" — and then the candidate said the same words." if prompted else "")) if quote else "")

    # The answers themselves
    for sign in (model_signs or [])[:4]:
        add(f"answer_{sign['kind']}", "review", MODEL_KINDS.get(sign["kind"], "Answer worth checking"),
            detail=f'"{sign["quote"]}" — {sign["why"]}' if sign.get("quote") else sign.get("why", ""))

    level = "serious" if any(s["strength"] == "serious" for s in signals) else "review" if signals else "none"
    verdict = {
        "serious": "There are strong signs the interview was not taken fairly. Watch the video at the times shown before deciding.",
        "review": "Some moments are worth checking in the video. None of them is proof on its own.",
        "none": "No signs of unfair means were found.",
    }[level]
    return {
        "level": level,
        "verdict": verdict,
        "signals": sorted(signals, key=lambda s: s["strength"] != "serious"),
        "checks": {"camera": camera, "voice": voice, "tab": "on"},
        "tab_switches": tab_count,
        "auto_terminated": auto_ended,
        "note": "These signs never change a score. A serious sign turns a 'Recommended' into 'Hold' so a person decides.",
    }
