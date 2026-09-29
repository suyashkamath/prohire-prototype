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

    # --- The report: built from the answers, with the rules applied in code ------
    from bot import report as rp
    sess = client.get(f"/api/sessions/{sid}").json()
    answer = ("I have six years in agency channel sales. I recruited 40 agents last year and 28 were still active "
              "after six months, because I trained them every week. My team closed 1.2 crore in premium in Pune, "
              "mostly life insurance, and I track every lead in Salesforce so nothing is missed.")
    sess["turns"] = [
        {"role": "interviewer", "text": "How have you recruited and activated agents?", "at": "2026-09-28T10:00:00+00:00"},
        {"role": "candidate", "text": answer, "at": "2026-09-28T10:00:20+00:00"},
    ]
    fake = {
        "skills": [
            {"skill": "Agency Channel", "asked": True, "score": 8, "evidence": "I recruited 40 agents last year and 28 were still active", "strength": "Clear numbers", "improvement": "More on retention", "interpretation": "Hands-on"},
            {"skill": "Life Insurance", "asked": True, "score": 6, "evidence": "a quote the candidate never said", "strength": "Mentions it", "improvement": "No product depth", "interpretation": "Relevant"},
            {"skill": "Gender", "asked": True, "score": 1},
        ],
        "soft_skills": {k: {"score": v, "reason": "ok"} for k, v in {"fluency": 7, "confidence": 8, "composure": 7, "communication": 6}.items()},
        "questions": [{"question": q["text"], "answered": i < 6, "summary": ""} for i, q in enumerate(sess["plan"]["questions"])],
        "summary": "Solid agency background.", "strengths": ["Numbers"], "concerns": ["Thin on product"], "observations": [],
    }
    r = rp.build(sess, fake)
    skill = {s["skill"]: s for s in r["skills"]}
    check("Report: only the job's skills appear (made-up ones dropped)", "Gender" not in skill and "Agency Channel" in skill)
    check("Report: a verbatim quote is kept", skill["Agency Channel"]["evidence"].startswith("I recruited 40 agents"))
    check("Report: a quote the candidate never said is dropped", skill["Life Insurance"]["evidence"] == "")
    check("Report: unasked skills are not scored", skill["Negotiation"]["score"] is None and not skill["Negotiation"]["asked"])
    check("Report: technical = average of the skills asked", r["technical"] == 7.0, str(r["technical"]))
    check("Report: soft = average of the four soft skills", r["soft"] == 7.0, str(r["soft"]))
    check("Report: recommendation comes from the scores, not the model", r["overall"] == 7.0 and r["recommendation"] in ("shortlist", "hold"))
    thin = dict(sess, turns=[{"role": "candidate", "text": "Yes.", "at": "2026-09-28T10:00:20+00:00"}])
    rt = rp.build(thin, {**fake, "questions": [{"question": "x", "answered": True}]})
    check("Report: too little said → not enough evidence, never reject", rt["outcome"] == "insufficient" and rt["recommendation"] == "hold")
    ended = dict(sess, end_reason="auto_terminated_tab_switches", events=[{"kind": "tab_switch"}] * 4)
    re_ = rp.build(ended, {**fake, "soft_skills": {k: {"score": 10} for k in rp.SOFT}, "skills": [dict(s, score=10) for s in fake["skills"]]})
    check("Report: ended for tab switching is never 'recommended'", re_["recommendation"] != "shortlist" and re_["proctoring"]["auto_terminated"])
    rf = rp.build(sess, None, error="network down")
    check("Report: AI failure is reported, not hidden", rf["error"] and rf["outcome"] == "insufficient" and "not available" in rf["rationale"])
    check("Report: the model is told language must not count", "Answering in Hindi is exactly as good" in rp.SYSTEM)

    # --- Fairness: signs of help or cheating ---------------------------------------
    from bot import integrity as ig
    from bot import voice_check as vc
    base = dict(sess, started_at="2026-09-28T10:00:00+00:00", end_reason="interviewer_closed", events=[],
                proctoring={"face_check": "on", "face_visible_share": 0.95, "answers": [], "episodes": []}, voice_check={"status": "done", "level": "none", "segments": []})
    check("Fairness: a clean interview has no signs", ig.assess(base)["level"] == "none")
    two = dict(base, events=[{"kind": "multiple_faces", "at": "2026-09-28T10:03:10+00:00", "detail": {"from_s": 184.0, "seconds": 6.0}}])
    f2 = ig.assess(two)
    check("Fairness: another face for 6 s is serious, with the time", f2["level"] == "serious" and f2["signals"][0]["times"] == [184.0])
    blip = dict(base, events=[{"kind": "multiple_faces", "detail": {"from_s": 30.0, "seconds": 1.6}}])
    check("Fairness: another face for a moment is only worth a look", ig.assess(blip)["level"] == "review")
    late = dict(base, proctoring={**base["proctoring"], "episodes": [{"kind": "multiple_faces", "from_s": 184.2, "seconds": 6.0}, {"kind": "multiple_faces", "from_s": 400.0, "seconds": 2.0}]}, events=two["events"])
    check("Fairness: episodes from the summary are added once, not twice", ig.assess(late)["signals"][0]["seconds"] == 8.0)
    dark = dict(base, events=[{"kind": "no_face", "detail": {"from_s": 10.0, "seconds": 40.0}}], proctoring={**base["proctoring"], "face_visible_share": 0.3})
    fd = ig.assess(dark)
    check("Fairness: a poor camera is reported as a camera problem, not as cheating", [s["kind"] for s in fd["signals"]] == ["camera"] and fd["level"] == "review")
    check("Fairness: out of view for 40 s is worth a look", "no_face" in [s["kind"] for s in ig.assess(dict(dark, proctoring=base["proctoring"]))["signals"]])
    short = dict(base, events=[{"kind": "looking_away", "detail": {"from_s": 50.0, "seconds": 8.0}}])
    check("Fairness: looking away briefly to think is not reported", ig.assess(short)["level"] == "none")
    poster = dict(two, proctoring={**base["proctoring"], "multi_share": 0.95})
    fp = ig.assess(poster)
    check("Fairness: a 'person' there the whole interview is taken as a poster, not a helper", fp["level"] == "review" and "photo" in fp["signals"][0]["detail"])
    phone = dict(base, events=[{"kind": "phone_visible", "detail": {"from_s": 70.0, "seconds": 9.0}}])
    check("Fairness: a phone in view is worth a look", [s["kind"] for s in ig.assess(phone)["signals"]] == ["phone_visible"])
    read = dict(base, proctoring={**base["proctoring"], "answers": [{"from_s": 90.0, "seconds": 40, "reading_like": True}]})
    check("Fairness: reading-like eye movement is worth a look, never serious", ig.assess(read)["level"] == "review")

    # Other voices on the microphone
    heard = dict(base, turns=[{"role": "interviewer", "text": "Tell me how you recruited agents for your branch.", "at": "2026-09-28T10:00:05+00:00"}],
                 mic_started_at="2026-09-28T10:00:02+00:00")
    entries = [
        {"speaker_id": "0", "start_time_seconds": 10, "end_time_seconds": 40, "transcript": "I have six years in agency sales in Pune."},
        {"speaker_id": "1", "start_time_seconds": 3, "end_time_seconds": 6, "transcript": "Tell me how you recruited agents for your branch."},
        {"speaker_id": "1", "start_time_seconds": 41, "end_time_seconds": 44, "transcript": "bolo forty agents recruited last year"},
        {"speaker_id": "0", "start_time_seconds": 45, "end_time_seconds": 55, "transcript": "Last year I recruited forty agents for the branch."},
        {"speaker_id": "2", "start_time_seconds": 60, "end_time_seconds": 60.4, "transcript": "haan"},
    ]
    va = vc.analyse(entries, heard)
    check("Voices: the interviewer leaking from the speakers is not another person", all("Tell me how" not in s["text"] for s in va["segments"]))
    check("Voices: someone saying the answer first is caught as prompting", va["level"] == "serious" and va["segments"][0]["prompted"])
    check("Voices: the time is from the start of the interview", va["segments"][0]["at_s"] == 43.0, str(va["segments"][0]["at_s"]))
    check("Voices: a half-second sound is ignored", all(s["seconds"] >= vc.MIN_SEGMENT for s in va["segments"]))
    alone = vc.analyse([e for e in entries if e["speaker_id"] == "0"], heard)
    check("Voices: one voice alone is no sign", alone["level"] == "none" and alone["speakers"] == 1)
    fv = ig.assess(dict(base, voice_check=va))
    check("Fairness: prompting is a serious sign, with what was heard", fv["level"] == "serious" and "forty agents" in fv["signals"][0]["detail"])

    # The report: signs are checked and never change a score
    signs = {**fake, "integrity_signs": [
        {"kind": "memorised", "quote": "I track every lead in Salesforce so nothing is missed", "why": "Sounds rehearsed"},
        {"kind": "memorised", "quote": "words the candidate never said", "why": "x"},
        {"kind": "rude", "quote": "I have six years", "why": "not a kind we use"},
    ]}
    rs = rp.build(dict(base, turns=sess["turns"]), signs)
    kinds = [s["kind"] for s in rs["proctoring"]["signals"]]
    check("Report: a sign with the candidate's own words is kept", kinds == ["answer_memorised"], str(kinds))
    check("Report: signs don't change the scores", rs["overall"] == r["overall"] and rs["technical"] == r["technical"])
    hi = {**fake, "soft_skills": {k: {"score": 9} for k in rp.SOFT}, "skills": [dict(s, score=9) for s in fake["skills"]]}
    longer = sess["turns"] + [{"role": "candidate", "text": "I also coach new agents on needs-based selling and review their calls every Friday.", "at": "2026-09-28T10:01:00+00:00"}]
    clean_r = rp.build(dict(base, turns=longer), hi)
    caught = rp.build(dict(two, turns=longer), hi)
    check("Report: a strong candidate is recommended when nothing is wrong", clean_r["recommendation"] == "shortlist")
    check("Report: a serious sign turns 'recommended' into 'hold', same scores", caught["recommendation"] == "hold" and caught["overall"] == clean_r["overall"])

    # The browser's summary is taken once, and only the fields we know
    ps_ = client.post(f"/api/sessions/{sid}/proctoring", json={"face_check": "on", "samples": 10, "episodes": [{"kind": "no_face", "from_s": 1, "seconds": 6}], "hack": "x"})
    check("Camera summary is saved", ps_.status_code == 200 and ss.get(sid)["proctoring"]["samples"] == 10)
    check("Camera summary drops unknown fields", "hack" not in ss.get(sid)["proctoring"])
    check("Camera summary can't be replaced afterwards", client.post(f"/api/sessions/{sid}/proctoring", json={"face_check": "on"}).status_code == 409)
    check("The agent is told to ask for specifics when an answer sounds read out",
          "specific example" in p["sarvam"]["agent_variables"]["extra_instructions"] or "specific example" in client.post("/api/preview", json={"job_id": "sls-0001", "candidate_id": "sneha"}).json()["sarvam"]["agent_variables"]["extra_instructions"])
    check("The candidate is told about the checks", "other voices" in client.get("/static/interview.js").text)

    # Pages load
    for path in ("/", f"/interview/{sid}", f"/session/{sid}", "/static/interview.js", "/static/pcm-worklet.js"):
        check(f"Page {path} loads", client.get(path).status_code == 200)

    # Only the interviewer ends the interview
    page = client.get(f"/interview/{sid}").text + client.get("/static/interview.js").text
    check("Candidate has no button to end the interview", "endBtn" not in page and "type: 'end'" not in page)
    bridge_src = (ROOT / "bot" / "bridge.py").read_text(encoding="utf-8")
    check("Server ignores an 'end' from the candidate", "candidate_ended" not in bridge_src and "time_limit" in bridge_src)

    # --- Turn-taking: the candidate is allowed to finish ---------------------------
    from array import array
    from bot import turns as tn
    loud = array("h", [3000, -3000] * 800).tobytes()     # 100 ms of speech
    quiet = bytes(3200)                                  # 100 ms of silence
    g = tn.AnswerGate(2.5)
    room = [g.feed(quiet) for _ in range(5)]
    check("Gate: between answers the room goes through (a few chunks late)", [len(r) for r in room] == [0, 0, 0, 1, 1])
    held = [g.feed(loud) for _ in range(20)]             # 2 s of answer…
    held += [g.feed(quiet) for _ in range(15)]           # …a 1.5 s pause to think…
    held += [g.feed(loud) for _ in range(20)]            # …and 2 s more
    check("Gate: nothing of an answer reaches the agent while it is being given", all(h == [] for h in held))
    check("Gate: the start of the answer is noticed", g.events == ["answer_started"])
    done = [g.feed(quiet) for _ in range(25)]            # 2.5 s of silence: the answer is over
    sent = [c for d in done for c in d]
    check("Gate: only a long pause sends the answer, all at once", sum(bool(d) for d in done) == 1 and bool(done[-1]))
    speech = [c for c in sent if c == loud]
    check("Gate: the whole answer is sent, both halves", len(speech) == 40, str(len(speech)))
    check("Gate: the thinking pause inside it is shortened", sum(c == quiet for c in sent) <= 3 + 3 + 3, str(sum(c == quiet for c in sent)))
    check("Gate: the answer ends with a clear silence", len(sent[-1]) == 16000 * 2 * 1.5)
    check("Gate: the caller is told the answer was sent", g.events[-1] == "answer_sent")
    g.events.clear()
    g.feed(loud)
    blip = [g.feed(quiet) for _ in range(25)]
    check("Gate: a cough is not sent as an answer", all(b == [] or b == [quiet] for b in blip) and "answer_sent" not in g.events)
    g2 = tn.AnswerGate(2.5)
    long = [g2.feed(loud) for _ in range(1200)]          # two minutes without a pause
    check("Gate: a very long answer is sent anyway", any(long))
    g.close()
    check("Gate: after the closing line nothing goes through", g.feed(loud) == [] and g.feed(quiet) == [])
    check("Pause setting is limited to 1–8 s", tn.AnswerGate(30).pause == 8 and tn.AnswerGate(0).pause == 1)
    check("Pause setting is refused outside 1–8 s", client.put("/api/jobs/sls-0001", json={"settings": {"answer_pause_seconds": 20}}).status_code == 400)
    client.put("/api/candidates/sneha", json={"overrides": {"answer_pause_seconds": 4}})
    ps4 = client.post("/api/preview", json={"job_id": "sls-0001", "candidate_id": "sneha"}).json()["plan"]
    check("Pause can be set per candidate", ps4["settings"]["answer_pause_seconds"] == 4.0)

    # --- The interviewer ends the interview; the candidate doesn't have to ---------
    check("Closing: Aarya's Hindi goodbye from a real interview is recognised",
          tn.is_closing("बिल्कुल सही कहा आपने। Divya जी, मेरी तरफ से सारे सवाल पूरे हो गए हैं। अपना समय देने के लिए बहुत-बहुत धन्यवाद।"))
    check("Closing: Aarya's English goodbye from a real interview is recognised",
          tn.is_closing("That is great to hear. Thank you so much for your time and for answering my questions today, Karthik."))
    check("Closing: the English closing line is recognised", tn.is_closing(tn.CLOSING_LINE["English"]))
    check("Closing: the Hindi closing line is recognised", tn.is_closing(tn.CLOSING_LINE["Hindi"]))
    for mid in ["धन्यवाद। तो चलिए शुरू करते हैं।", "Thank you. Let's move to the next question.",
                "दस दिन का notice period तो काफी कम है, यह अच्छी बात है।", "Shall we begin?"]:
        check(f"Closing: an ordinary line doesn't end it ({mid[:24]}…)", not tn.is_closing(mid))
    ending = client.post("/api/preview", json={"job_id": "sls-0001", "candidate_id": "arjun"}).json()["sarvam"]["agent_variables"]["extra_instructions"]
    check("The agent is told the exact closing line", tn.CLOSING_LINE["Hindi"] in ending)

    # --- One answer said in pieces is kept once, not repeated ---------------------
    a1 = "सो मेरे पास एक साल चार महीने का एक्सपीरियंस है।"
    a2 = "सो मेरे पास एक साल चार महीने का एक्सपीरियंस है और मैं टेली सेल्स एग्जीक्यूटिव में कस्टमर्स को फोन करता हूं।"
    check("Transcript: a carried-on answer gives only the new part", tn.continuation(a1, a2) == "और मैं टेली सेल्स एग्जीक्यूटिव में कस्टमर्स को फोन करता हूं।", tn.continuation(a1, a2))
    check("Transcript: small re-transcription differences still match",
          tn.continuation("मेरा करंट CTC है 7 लाख पर ईयर।", "मेरा करंट CTC है 7 लाख्स पर ईयर और एक्सपेक्टेड मुझे चाहिए 15 लाख।") == "और एक्सपेक्टेड मुझे चाहिए 15 लाख।")
    check("Transcript: a different answer is not merged", tn.continuation(a1, "मेरा नोटिस पीरियड अभी 10 दिन का है।") is None)
    sid2 = client.post("/api/sessions", json={"job_id": "sls-0001", "candidate_id": "divya"}).json()["id"]
    ss.add_turn(sid2, "interviewer", "Tell me about your role.")
    ss.add_turn(sid2, "candidate", a1)
    grown = ss.add_turn(sid2, "candidate", a2)
    check("Transcript: the same answer grows in place", grown["replace"] and [t["text"] for t in ss.get(sid2)["turns"]][-1] == a2 and len(ss.get(sid2)["turns"]) == 2)
    ss.add_turn(sid2, "interviewer", "अच्छा।")
    check("Transcript: an identical re-send is dropped", ss.add_turn(sid2, "candidate", a2) is None and len(ss.get(sid2)["turns"]) == 3)

    # --- Interviews sent from ProHire ------------------------------------------------
    import os
    from bot import agent_vars, prohire as ph
    for k in ("SMTP_HOST", "SMTP_FROM", "SMTP_USER", "PUBLIC_URL"):
        os.environ.pop(k, None)
    from_prohire = {
        "company": "Probus Insurance",
        "job": {"id": "j1", "reference": "IT-0001", "title": "ASP.NET Developer", "skills_required": ["C#", "SQL Server"], "primary_skill": "C#"},
        "candidate": {"id": "c1", "name": "Meera Iyer", "experience_years": 3, "current": {"title": "Engineer", "company": "Zenith"}, "skills": ["C#"], "languages": ["Hindi"], "salary": "not allowed"},
        "settings": {"language": "Hindi", "strictness": "strict", "duration_minutes": 15, "answer_pause_seconds": 3, "instructions": "Be kind.", "max_tab_switches": 99, "unknown": 1},
        "questions": [{"id": "r1", "text": "Tell me about SQL tuning.", "text_hi": "SQL tuning के बारे में बताइए।", "must_ask": True}, {"id": "r2", "text": "Why move?"}, {"text": "  "}],
        "prohire": {"session_id": "s1", "application_id": "a1", "expires_at": "2099-01-01T00:00:00Z", "other": "x"},
    }
    made = client.post("/api/prohire/sessions", json=from_prohire)
    check("ProHire: an interview is created from ProHire's plan", made.status_code == 200 and made.json()["url"].startswith("http") and made.json()["url"].endswith(f"/interview/{made.json()['id']}"), made.text)
    ps_ = client.get(f"/api/sessions/{made.json()['id']}").json()["plan"]
    check("ProHire: the candidate comes as sent, and nothing else", ps_["candidate"]["name"] == "Meera Iyer" and "salary" not in ps_["candidate"])
    check("ProHire: the recruiter's settings are kept, unknown ones dropped", ps_["settings"]["strictness"] == "strict" and ps_["settings"]["answer_pause_seconds"] == 3.0 and "unknown" not in ps_["settings"])
    check("ProHire: Hindi questions are asked in Hindi; blank ones are dropped", [q["asked_as"] for q in ps_["questions"]] == ["SQL tuning के बारे में बताइए।", "Why move?"] and ps_["questions"][1]["in_english_only"])
    check("ProHire: the agent is told the recruiter's instructions", "Be kind." in agent_vars.variables(ps_)["extra_instructions"])
    check("ProHire: the ProHire records are kept, other keys dropped", ps_["prohire"] == {"session_id": "s1", "application_id": "a1", "expires_at": "2099-01-01T00:00:00Z"})
    check("ProHire: a plan with no questions is refused", client.post("/api/prohire/sessions", json={**from_prohire, "questions": []}).status_code == 400)
    check("ProHire: a language the call can't speak is refused", client.post("/api/prohire/sessions", json={**from_prohire, "settings": {"language": "Tamil"}}).status_code == 400)
    os.environ["PUBLIC_URL"] = "https://interview.probus.example/"
    check("ProHire: the link uses the public address when set", client.post("/api/prohire/sessions", json=from_prohire).json()["url"].startswith("https://interview.probus.example/interview/"))
    os.environ.pop("PUBLIC_URL")
    pid = made.json()["id"]
    check("ProHire: the invite can't be emailed until SMTP is set up", client.post(f"/api/prohire/sessions/{pid}/email", json={"to": "m@x.in", "subject": "s", "body": f"/interview/{pid}"}).status_code == 503)
    sess_ = ss.get(pid)
    link = f"/interview/{pid}"
    def refused(**kw):
        args = {"to": "meera@example.com", "cc": "", "subject": "Your interview", "body": f"Start here: http://h{link}", "link": link, **kw}
        try:
            ph.check_email(sess_, **args)
            return False
        except ValueError:
            return True
    check("ProHire: an email must carry this interview's link", refused(body="Hello") and not refused())
    check("ProHire: bad or too many addresses are refused", refused(to="not-an-email") and refused(to="a@b.in", cc="c@d.in,e@f.in,g@h.in,i@j.in,k@l.in"))
    try:
        ph.check_email({**sess_, "plan": {**sess_["plan"], "prohire": {}}}, "a@b.in", "", "s", link, link)
        only_prohire = False
    except ValueError:
        only_prohire = True
    check("ProHire: an interview made on this server's own page can't be emailed from here", only_prohire)
    check("ProHire: a resend moves the expiry", client.post(f"/api/prohire/sessions/{pid}/invite", json={"expires_at": "2000-01-01T00:00:00Z"}).status_code == 200 and client.get(f"/api/sessions/{pid}/public").json()["status"] == "expired")
    check("ProHire: an expired link says so", ph.expired(ss.get(pid)))
    client.post(f"/api/prohire/sessions/{pid}/invite", json={"expires_at": "2099-01-01T00:00:00Z"})
    check("ProHire: cancelling ends the link", client.post(f"/api/prohire/sessions/{pid}/invite", json={"cancel": True}).json()["status"] == "ended" and ss.get(pid)["end_reason"] == "cancelled")
    check("ProHire: only ProHire's console may call in (CORS)", client.options("/api/prohire/sessions", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"}).headers.get("access-control-allow-origin") is None
          and client.options("/api/prohire/sessions", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"}).headers.get("access-control-allow-origin") == "http://localhost:5173")

    sent_mail = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            self.host, self.port = host, port
        def __enter__(self):
            return self
        def __exit__(self, *exc):
            return False
        def starttls(self, context=None):
            pass
        def login(self, user, password):
            pass
        def send_message(self, msg):
            sent_mail.append(msg)
    real_smtp = ph.smtplib.SMTP
    ph.smtplib.SMTP = FakeSMTP
    os.environ.update({"SMTP_HOST": "smtp.test", "SMTP_FROM": "hr@probus.example"})
    try:
        fresh_id = client.post("/api/prohire/sessions", json=from_prohire).json()["id"]
        ok = client.post(f"/api/prohire/sessions/{fresh_id}/email", json={"to": "meera@example.com", "subject": "Your interview", "body": f"Start: http://h/interview/{fresh_id}"})
        check("ProHire: the invite is emailed from the HR mailbox", ok.status_code == 200 and sent_mail and sent_mail[0]["To"] == "meera@example.com" and sent_mail[0]["From"] == "hr@probus.example", ok.text)
        check("ProHire: each email sent is noted on the interview", ss.get(fresh_id)["emails"][0]["to"] == "meera@example.com")
        check("Status says email is ready", client.get("/api/status").json()["email"] is True)
    finally:
        ph.smtplib.SMTP = real_smtp
        for k in ("SMTP_HOST", "SMTP_FROM"):
            os.environ.pop(k, None)

    assert not failures, failures


if __name__ == "__main__":
    try:
        test_all()
        print("\n  all passed")
    except AssertionError:
        print(f"\n  {len(failures)} failed")
        sys.exit(1)
