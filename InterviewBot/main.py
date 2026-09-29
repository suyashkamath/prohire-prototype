"""ProHire InterviewBot — the AI interview, built on a Sarvam voice agent.

Run:  .venv\\Scripts\\python -m uvicorn main:app --reload --port 8000
Open: http://localhost:8000

Settings page (/)            pick a job and candidate, edit any setting, start
Interview page (/interview)  what the candidate sees
Session page (/session)      transcript, events and recording afterwards

Keys stay in .env and on this server. This is a local prototype: the API below
has no login of its own, so run it on your own machine only.
"""

import asyncio
import logging
import os

from fastapi import Body, FastAPI, File, HTTPException, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from bot import agent_vars, config_store, prohire, report, sessions
from bot.bridge import run_interview
from bot.settings import ROOT, load

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="ProHire InterviewBot")
# The ProHire console (a browser app on another port) calls the /api/prohire
# routes and reads sessions back. Only its own address is let in.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("PROHIRE_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
WEB = ROOT / "web"
app.mount("/static", StaticFiles(directory=WEB), name="static")


def _not_found(err: KeyError):
    raise HTTPException(status_code=404, detail=str(err).strip("'\""))


# --- pages ---------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def settings_page():
    return FileResponse(WEB / "index.html")


@app.get("/interview/{session_id}", include_in_schema=False)
def interview_page(session_id: str):
    return FileResponse(WEB / "interview.html")


@app.get("/session/{session_id}", include_in_schema=False)
def session_page(session_id: str):
    return FileResponse(WEB / "session.html")


# --- status --------------------------------------------------------------------

@app.get("/api/status")
def status():
    s = load()
    return {
        "ready": not s.missing(),
        "missing": s.missing(),
        "api_key_from": s.api_key_from,     # the variable's NAME, never its value
        "agent_variables": agent_vars.VARIABLE_NAMES,
        "email": prohire.email_ready(),     # can the invite be emailed from here (SMTP set up)?
    }


# --- settings: editable as often as you like ------------------------------------

@app.get("/api/company")
def get_company():
    return config_store.company()


@app.put("/api/company")
def put_company(doc: dict = Body(...)):
    try:
        return config_store.save_company(doc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/jobs")
def get_jobs():
    return config_store.list_jobs()


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    try:
        return config_store.job(job_id)
    except KeyError as e:
        _not_found(e)


@app.put("/api/jobs/{job_id}")
def put_job(job_id: str, doc: dict = Body(...)):
    try:
        return config_store.save_job(job_id, doc)
    except KeyError as e:
        _not_found(e)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/candidates")
def get_candidates():
    return config_store.list_candidates()


@app.put("/api/candidates/{candidate_id}")
def put_candidate(candidate_id: str, doc: dict = Body(...)):
    try:
        return config_store.save_candidate(candidate_id, doc)
    except KeyError as e:
        _not_found(e)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/preview")
def preview(body: dict = Body(...)):
    """The combined plan and exactly what Sarvam would receive — nothing saved."""
    try:
        plan = config_store.resolve(body["job_id"], body["candidate_id"], body.get("overrides"))
    except KeyError as e:
        _not_found(e)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    o = agent_vars.overrides(plan)
    return {
        "plan": plan,
        "sarvam": {
            "agent_variables": o["agent_variables"],
            "initial_language_name": str(o["initial_language_name"]),
            "initial_bot_message": o["initial_bot_message"],
            "speech_hotwords": o["speech_hotwords"],
            "voice_speaker": plan["settings"].get("voice_speaker") or None,
        },
    }


# --- sessions --------------------------------------------------------------------

@app.post("/api/sessions")
def create_session(body: dict = Body(...)):
    """Freeze the plan and make an interview link."""
    try:
        plan = config_store.resolve(body["job_id"], body["candidate_id"], body.get("overrides"))
    except KeyError as e:
        _not_found(e)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    s = sessions.create(plan)
    return {"id": s["id"], "url": f"/interview/{s['id']}"}


def _public_url(request: Request, path: str) -> str:
    """An absolute link a candidate can open. PUBLIC_URL (in .env) is the address
    candidates reach this server on; without it, the address ProHire used."""
    base = (os.getenv("PUBLIC_URL") or str(request.base_url)).rstrip("/")
    return f"{base}{path}"


@app.post("/api/prohire/sessions")
def create_prohire_session(request: Request, body: dict = Body(...)):
    """An interview set up in ProHire: its frozen plan in, an interview link out."""
    try:
        plan = prohire.plan_from(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    s = sessions.create(plan)
    return {"id": s["id"], "url": _public_url(request, f"/interview/{s['id']}")}


@app.post("/api/prohire/sessions/{session_id}/invite")
def update_prohire_invite(session_id: str, body: dict = Body(...)):
    """ProHire resent (new expiry) or cancelled the invite."""
    try:
        s = sessions.get(session_id)
    except KeyError as e:
        _not_found(e)
    if not s["plan"].get("prohire"):
        raise HTTPException(status_code=400, detail="Not an interview from ProHire.")
    if body.get("cancel"):
        if s["status"] == "live":
            raise HTTPException(status_code=409, detail="The interview is in progress.")
        sessions.end(session_id, "cancelled")
    elif body.get("expires_at"):
        sessions.set_expiry(session_id, str(body["expires_at"]))
    return {"ok": True, "status": sessions.get(session_id)["status"]}


@app.post("/api/prohire/sessions/{session_id}/email")
async def email_invite(session_id: str, body: dict = Body(...)):
    """Email the candidate their interview link from the HR mailbox."""
    if not prohire.email_ready():
        raise HTTPException(status_code=503, detail="Email is not set up on the interview server (SMTP_HOST, SMTP_FROM in .env).")
    try:
        s = sessions.get(session_id)
    except KeyError as e:
        _not_found(e)
    to, cc = str(body.get("to") or ""), str(body.get("cc") or "")
    subject, text = str(body.get("subject") or ""), str(body.get("body") or "")
    try:
        prohire.check_email(s, to, cc, subject, text, link=f"/interview/{session_id}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        await asyncio.to_thread(prohire.send_email, to, cc, subject, text)
    except Exception as e:  # the mail server said no
        logging.getLogger("interviewbot").exception("Invite email for %s failed", session_id)
        raise HTTPException(status_code=502, detail=f"The email could not be sent: {e}")
    sessions.add_email(session_id, to, cc, subject)
    return {"ok": True}


@app.get("/api/sessions")
def list_sessions():
    return [
        {k: s[k] for k in ("id", "created_at", "status", "end_reason")}
        | {"candidate": s["plan"]["candidate"]["name"], "job": s["plan"]["job"]["title"],
           "language": s["plan"]["settings"].get("language"), "turns": len(s["turns"])}
        for s in sessions.list_all()
    ]


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        _not_found(e)


@app.post("/api/sessions/{session_id}/report")
async def make_report(session_id: str):
    """Score the interview from the candidate's answers (again, if already done)."""
    try:
        return await report.generate(session_id)
    except KeyError as e:
        _not_found(e)


@app.get("/api/sessions/{session_id}/public")
def get_session_public(session_id: str):
    """What the candidate's page may see: never the question list."""
    try:
        s = sessions.get(session_id)
    except KeyError as e:
        _not_found(e)
    p = s["plan"]
    return {
        "id": s["id"],
        "status": "expired" if s["status"] == "ready" and prohire.expired(s) else s["status"],
        "candidate_name": p["candidate"]["name"],
        "job_title": p["job"]["title"],
        "company": p["company"],
        "interviewer_name": p["settings"].get("interviewer_name", "Aarya"),
        "language": p["settings"].get("language", "English"),
        "duration_minutes": p["settings"].get("duration_minutes", 30),
        "max_tab_switches": p["settings"].get("max_tab_switches", 3),
    }


PROCTORING_KEYS = {
    "face_check", "reason", "samples", "face_visible_share", "totals", "answers", "episodes",
    "screen_extended", "virtual_camera", "camera_label", "people_check", "multi_share",
}


@app.post("/api/sessions/{session_id}/proctoring")
def save_proctoring(session_id: str, body: dict = Body(...)):
    """The camera summary from the candidate's page (web/proctor.js), sent once as it closes."""
    try:
        s = sessions.get(session_id)
    except KeyError as e:
        _not_found(e)
    if s.get("proctoring"):
        raise HTTPException(status_code=409, detail="Already received.")
    summary = {k: v for k, v in body.items() if k in PROCTORING_KEYS}
    for key in ("answers", "episodes"):
        summary[key] = [a for a in (summary.get(key) or []) if isinstance(a, dict)][:200]
    sessions.save_proctoring(session_id, summary)
    return {"ok": True}


@app.post("/api/sessions/{session_id}/recording")
async def upload_recording(session_id: str, file: UploadFile = File(...)):
    suffix = ".mp4" if (file.content_type or "").endswith("mp4") else ".webm"
    try:
        name = sessions.save_recording(session_id, await file.read(), suffix)
    except KeyError as e:
        _not_found(e)
    return {"recording": name}


@app.get("/api/sessions/{session_id}/recording", include_in_schema=False)
def get_recording(session_id: str):
    try:
        s = sessions.get(session_id)
    except KeyError as e:
        _not_found(e)
    if not s.get("recording"):
        raise HTTPException(status_code=404, detail="No recording for this interview.")
    return FileResponse(sessions.RECORDINGS / s["recording"])


@app.websocket("/ws/interview/{session_id}")
async def interview_socket(ws: WebSocket, session_id: str):
    await run_interview(ws, session_id)
