"""Checks that run without calling Sarvam: settings, layering, freezing, pages.

Run:  .venv\\Scripts\\python -m pytest -q      (or: .venv\\Scripts\\python tests\\test_bot.py)
"""

import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Work on a copy of the data so tests never touch the real settings.
_tmp = Path(tempfile.mkdtemp())
shutil.copytree(ROOT / "data", _tmp / "data", ignore=shutil.ignore_patterns("sessions", "recordings", "history"))

# Start from clean settings, whatever has been edited on the settings page.
import json as _json  # noqa: E402
for _p in (_tmp / "data" / "jobs").glob("*.json"):
    _d = _json.loads(_p.read_text(encoding="utf-8"))
    _d.get("interview", {}).pop("settings", None)
    _p.write_text(_json.dumps(_d, ensure_ascii=False), encoding="utf-8")
for _p in (_tmp / "data" / "candidates").glob("*.json"):
    _d = _json.loads(_p.read_text(encoding="utf-8"))
    _d["overrides"] = {}
    _p.write_text(_json.dumps(_d, ensure_ascii=False), encoding="utf-8")

import bot.settings as settings_mod  # noqa: E402
settings_mod.DATA = _tmp / "data"
import bot.config_store as cs  # noqa: E402
import bot.sessions as ss  # noqa: E402
for mod in (cs, ss):
    for name in ("COMPANY_FILE", "JOBS", "CANDIDATES", "HISTORY", "SESSIONS", "RECORDINGS"):
        if hasattr(mod, name):
            setattr(mod, name, _tmp / "data" / {"COMPANY_FILE": "company.json", "JOBS": "jobs", "CANDIDATES": "candidates", "HISTORY": "history", "SESSIONS": "sessions", "RECORDINGS": "recordings"}[name])

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

client = TestClient(app)
failures = []


def check(name, cond, detail=""):
    print(("  ✓ " if cond else "  ✕ ") + name + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def test_all():
    # Data exported from the ProHire prototype
    jobs = client.get("/api/jobs").json()
    check("Two ProHire jobs loaded", {j["reference"] for j in jobs} == {"SLS-0001", "SLS-0002"})
    cands = client.get("/api/candidates").json()
    check("Four ProHire candidates loaded", {c["id"] for c in cands} == {"sneha", "arjun", "divya", "karthik"})

    # Layering: company → job → candidate → interview
    p = client.post("/api/preview", json={"job_id": "sls-0001", "candidate_id": "sneha"}).json()
    check("Defaults come from the company", p["plan"]["settings"]["language"] == "English" and p["plan"]["settings_from"]["language"] == "company")
    check("Candidate's own resume question is included", any(q["id"] == "resume" for q in p["plan"]["questions"]))
    check("Primary-skill question is always asked", any(q["must_ask"] and "agents" in q["text"] for q in p["plan"]["questions"]))
    check("Sarvam gets the questions as a variable", "1." in p["sarvam"]["agent_variables"]["questions"])
    check("Sarvam gets the job's skills as key terms", "Agency Channel" in p["sarvam"]["speech_hotwords"])

    # Editable, repeatedly — the point of the whole exercise
    job = client.get("/api/jobs/sls-0001").json()
    v1 = job.get("version", 1)
    qs = job["interview"]["questions"] + [{"text": "What does a good day in the field look like for you?", "text_hi": "", "must_ask": True}]
    r1 = client.put("/api/jobs/sls-0001", json={"questions": qs, "settings": {"strictness": "strict"}}).json()
    r2 = client.put("/api/jobs/sls-0001", json={"settings": {"strictness": "lenient", "duration_minutes": 20}}).json()
    check("Job settings can be saved again and again", r2["version"] == v1 + 2, f"{v1} → {r2['version']}")
    check("Each save keeps the old version", len(list((cs.HISTORY).glob("job-sls-0001-v*.json"))) >= 2)
    p2 = client.post("/api/preview", json={"job_id": "sls-0001", "candidate_id": "sneha"}).json()["plan"]
    check("Latest job edit is used", p2["settings"]["strictness"] == "lenient" and p2["settings"]["duration_minutes"] == 20)
    check("Added question is asked", any("good day in the field" in q["text"] for q in p2["questions"]))

    # Per-candidate: two candidates on one job, different settings
    client.put("/api/candidates/arjun", json={"overrides": {"language": "Hindi", "strictness": "strict"}})
    pa = client.post("/api/preview", json={"job_id": "sls-0001", "candidate_id": "arjun"}).json()
    ps = client.post("/api/preview", json={"job_id": "sls-0001", "candidate_id": "sneha"}).json()
    check("Same job, one candidate in Hindi, one in English", pa["plan"]["settings"]["language"] == "Hindi" and ps["plan"]["settings"]["language"] == "English")
    check("Hindi candidate gets Hindi questions", any("आप" in q["asked_as"] or "बताइए" in q["asked_as"] for q in pa["plan"]["questions"]))
    check("Question with no Hindi version is flagged", any(q["in_english_only"] for q in pa["plan"]["questions"]))
    check("Sarvam starts the Hindi candidate in Hindi", pa["sarvam"]["initial_language_name"] == "Hindi")
    check("Candidate setting beats the job's", pa["plan"]["settings"]["strictness"] == "strict" and pa["plan"]["settings_from"]["strictness"] == "candidate")

    # Freeze: an interview keeps the settings it started with
    sid = client.post("/api/sessions", json={"job_id": "sls-0001", "candidate_id": "sneha"}).json()["id"]
    client.put("/api/jobs/sls-0001", json={"settings": {"duration_minutes": 45}})
    frozen = client.get(f"/api/sessions/{sid}").json()["plan"]["settings"]["duration_minutes"]
    check("Editing the job later does not change an interview already made", frozen == 20, str(frozen))

    pub = client.get(f"/api/sessions/{sid}/public").json()
    check("Candidate's page never gets the question list", "questions" not in pub and pub["candidate_name"] == "Sneha Deshpande")

    # Validation
    bad = client.put("/api/jobs/sls-0001", json={"settings": {"language": "Klingon"}})
    check("Unknown language is refused", bad.status_code == 400)
    check("Unknown job is a 404", client.get("/api/jobs/nope").status_code == 404)

    # Without Sarvam IDs the live socket explains what's missing instead of crashing
    st = client.get("/api/status").json()
    if not st["ready"]:
        with client.websocket_connect(f"/ws/interview/{sid}") as ws:
            msg = ws.receive_json()
        check("Live interview says which settings are missing", msg["type"] == "error" and "missing" in msg["message"])

    # The agent's results are picked out of its raw messages, whatever their shape
    from bot.bridge import _results_from
    check("Results read from agent_variables", _results_from({"agent_variables": {"experience_rating": "4", "candidate_name": "x", "call_summary": ""}}) == {"experience_rating": "4"})
    check("Results read from a single variable update", _results_from({"type": "server.event.variable_update", "variable_name": "expected_ctc", "value": "12 LPA"}) == {"expected_ctc": "12 LPA"})
    check("Gender is never kept as a result", _results_from({"agent_variables": {"gender": "male"}}) == {})
    check("Sarvam gets the agent's own input names", {"role_applied", "resume_summary"} <= set(p["sarvam"]["agent_variables"]))

    # Pages load
    for path in ("/", f"/interview/{sid}", f"/session/{sid}", "/static/interview.js", "/static/pcm-worklet.js"):
        check(f"Page {path} loads", client.get(path).status_code == 200)

    assert not failures, failures


if __name__ == "__main__":
    try:
        test_all()
        print("\n  all passed")
    except AssertionError:
        print(f"\n  {len(failures)} failed")
        sys.exit(1)
