"""ProHire InterviewBot — the AI interview, built on a Sarvam voice agent.

Run:  .venv\\Scripts\\python -m uvicorn main:app --reload --port 8000
Open: http://localhost:8000

Settings page (/)            pick a job and candidate, edit any setting, start
Interview page (/interview)  what the candidate sees
Session page (/session)      transcript, events and recording afterwards

Keys stay in .env and on this server. This is a local prototype: the API below
has no login of its own, so run it on your own machine only.
"""

import logging

from fastapi import Body, FastAPI, File, HTTPException, UploadFile, WebSocket
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from bot import agent_vars, config_store, sessions
from bot.bridge import run_interview
from bot.settings import ROOT, load

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="ProHire InterviewBot")
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
        "status": s["status"],
        "candidate_name": p["candidate"]["name"],
        "job_title": p["job"]["title"],
        "company": p["company"],
        "interviewer_name": p["settings"].get("interviewer_name", "Aarya"),
        "language": p["settings"].get("language", "English"),
        "duration_minutes": p["settings"].get("duration_minutes", 30),
        "max_tab_switches": p["settings"].get("max_tab_switches", 3),
    }


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
