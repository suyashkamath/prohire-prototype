"""The live interview: browser ⇄ this server ⇄ Sarvam agent.

The browser never talks to Sarvam and never sees the API key. It streams the
candidate's microphone (16 kHz, 16-bit PCM, base64) to this server over a
WebSocket; the server passes it to the Sarvam agent and sends the agent's voice,
transcripts and events back.

Messages from the browser:   {"type": "audio", "audio": "<base64 pcm>"}
                             {"type": "event", "kind": "tab_switch" | "multiple_faces" | …, "detail": {...}}
                                 (the fairness checks — see web/proctor.js and bot/integrity.py)

The candidate's microphone is also saved on its own, exactly as received, so
it can be checked for other voices afterwards (bot/voice_check.py).

The candidate's pauses are held back so the agent lets them finish an answer
(see turns.AnswerGate).

Only the interviewer ends the interview: when the agent says its closing line
the server ends the call once that line has been spoken, even if the agent does
not hang up itself. The server also stops it at the time limit (or for leaving
the tab). The candidate has no "end" message — one sent anyway is ignored.
Messages to the browser:     {"type": "status", "state": "connecting|live|ended", ...}
                             {"type": "audio", "audio": "<base64>", "sample_rate": 16000}
                             {"type": "transcript", "role": "interviewer|candidate", "text": "...",
                              "replace": true}         (replaces the last candidate bubble)
                             {"type": "speech", "state": "start|end"}   (answer started / sent to the agent)
                             {"type": "interrupt"}                     (stop playing the agent)
                             {"type": "warning", "count": n, "limit": m}
                             {"type": "error", "message": "..."}
"""

import asyncio
import base64
import logging
import time
import wave

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import SecretStr
from sarvam_conv_ai_sdk import (
    AsyncSamvaadAgent,
    InteractionConfig,
    InteractionType,
    Role,
    ServerAudioChunkMsg,
    ServerEventBase,
    ServerInteractionEndEvent,
    ServerTranscriptMsg,
    ServerUserInterruptEvent,
)
from sarvam_conv_ai_sdk.messages.events import ServerInteractionConnectedEvent
from sarvam_conv_ai_sdk.messages.types import UserIdentifierType

from . import agent_vars, prohire, report, sessions, turns
from .settings import load

log = logging.getLogger("interviewbot.bridge")
SAMPLE_RATE = 16000
GRACE_MINUTES = 5   # past the planned duration, the server ends it if the agent hasn't
CLOSING_QUIET = 2.0     # after the closing line: seconds with no agent audio = it has finished speaking
CLOSING_MAX_WAIT = 30   # … but end by then whatever happens


class _Agent(AsyncSamvaadAgent):
    """The SDK's agent, plus the messages it does not pass on.

    The agent reports its results (ratings, CTC, disposition…) as variable
    updates, which sarvam-conv-ai-sdk 1.1.1 does not hand to any callback. This
    looks at every raw message first. It relies on a private method, so check
    it when upgrading the SDK (requirements.txt pins the version).
    """

    def __init__(self, *args, on_raw=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._on_raw = on_raw

    async def _route_message(self, message):
        if self._on_raw:
            try:
                await self._on_raw(message)
            except Exception:
                log.exception("Could not read a raw agent message")
        await super()._route_message(message)


def _results_from(message: dict) -> dict:
    """The agent's result variables in a raw message, whatever its shape."""
    wanted = set(agent_vars.RESULT_NAMES)
    found = {}
    if isinstance(message.get("agent_variables"), dict):
        found.update({k: v for k, v in message["agent_variables"].items() if k in wanted})
    name = message.get("variable_name") or message.get("name") or message.get("key")
    value = message.get("value", message.get("variable_value"))
    if name in wanted:
        found[name] = value
    for key in wanted & message.keys():
        found[key] = message[key]
    return {k: v for k, v in found.items() if v not in (None, "")}


_background: set = set()   # keep report tasks alive until they finish


def _schedule_report(session_id: str) -> None:
    task = asyncio.create_task(_report_later(session_id))
    _background.add(task)
    task.add_done_callback(_background.discard)


SUMMARY_WAIT = 30   # seconds to wait for the browser's camera summary before scoring


async def _report_later(session_id: str) -> None:
    try:
        # The browser sends its camera summary as it closes; give it a moment.
        for _ in range(SUMMARY_WAIT):
            if sessions.get(session_id).get("proctoring"):
                break
            await asyncio.sleep(1)
        await report.generate(session_id)     # also checks the microphone for other voices
    except Exception:
        log.exception("Could not build the report for %s", session_id)


async def run_interview(ws: WebSocket, session_id: str) -> None:
    await ws.accept()
    send_lock = asyncio.Lock()

    async def send(msg: dict) -> None:
        async with send_lock:
            try:
                await ws.send_json(msg)
            except Exception:  # browser already gone
                pass

    try:
        session = sessions.get(session_id)
    except KeyError:
        await send({"type": "error", "message": "This interview link is not valid."})
        await ws.close()
        return
    if session["status"] == "ended":
        await send({"type": "error", "message": "This interview has already ended."})
        await ws.close()
        return
    if prohire.expired(session):
        await send({"type": "error", "message": "This invitation has expired. Ask your recruiter for a new link."})
        await ws.close()
        return

    settings = load()
    if settings.missing():
        await send({"type": "error", "message": f"The server is missing: {', '.join(settings.missing())}. Add them to .env."})
        await ws.close()
        return

    plan = session["plan"]
    limit = int(plan["settings"].get("max_tab_switches", 3))
    max_seconds = (int(plan["settings"].get("duration_minutes", 30)) + GRACE_MINUTES) * 60
    gate = turns.AnswerGate(plan["settings"].get("answer_pause_seconds", turns.DEFAULT_PAUSE_SECONDS))
    closing = asyncio.Event()           # the interviewer has said its closing line
    last_agent_audio = [time.monotonic()]

    async def on_audio(msg: ServerAudioChunkMsg) -> None:
        if msg.audio_base64:
            last_agent_audio[0] = time.monotonic()
            await send({"type": "audio", "audio": msg.audio_base64, "sample_rate": msg.sample_rate or SAMPLE_RATE})

    async def on_transcript(msg: ServerTranscriptMsg) -> None:
        role = "candidate" if msg.role == Role.USER else "interviewer"
        turn = sessions.add_turn(session_id, role, msg.content)
        if turn:
            await send({"type": "transcript", **turn})
        if role == "interviewer" and turns.is_closing(msg.content) and not closing.is_set():
            log.info("Interview %s: closing line heard, ending once it has been spoken", session_id)
            gate.close()                # nothing the candidate says now starts another turn
            closing.set()

    async def on_event(event: ServerEventBase) -> None:
        if isinstance(event, ServerInteractionConnectedEvent):
            sessions.mark_live(session_id, event.interaction_id)
        elif isinstance(event, ServerUserInterruptEvent):
            await send({"type": "interrupt"})
        # Sarvam's own speech start/end are not passed on: it hears an answer only
        # after the candidate has finished, so the gate's events are the true ones.
        elif isinstance(event, ServerInteractionEndEvent):
            await send({"type": "status", "state": "ended", "reason": "agent_ended"})

    async def on_raw(message: dict) -> None:
        kind = message.get("type", "")
        if kind == "server.action.interaction_connected" and message.get("interaction_id"):
            sessions.mark_live(session_id, message["interaction_id"])
        if kind in ("server.event.variable_update", "server.action.interaction_end") or "agent_variables" in message:
            found = _results_from(message)
            if found or kind == "server.event.variable_update":
                keep = {k: v for k, v in message.items() if k not in ("timestamp", "origin", "audio_base64")}
                keep.pop("agent_variables", None)   # inputs we sent; results are kept separately
                sessions.merge_results(session_id, found, raw=keep)
                if found:
                    await send({"type": "results", "results": found})

    config = InteractionConfig(
        user_identifier_type=UserIdentifierType.CUSTOM,
        user_identifier=session_id,
        org_id=settings.org_id,
        workspace_id=settings.workspace_id,
        app_id=settings.app_id,
        version=settings.app_version,
        interaction_type=InteractionType.CALL,
        sample_rate=SAMPLE_RATE,
        **agent_vars.overrides(plan),
    )
    agent = _Agent(
        api_key=SecretStr(settings.api_key),
        config=config,
        audio_callback=on_audio,
        transcript_callback=on_transcript,
        event_callback=on_event,
        on_raw=on_raw,
    )

    reason = "connection_lost"
    mic = None                          # the candidate's microphone, saved as it arrives
    answer_began = [None, 0.0]          # when the answer being given started (iso, monotonic)
    await send({"type": "status", "state": "connecting"})
    try:
        await agent.start()
        if not await agent.wait_for_connect(timeout=15.0):
            await send({"type": "error", "message": "Could not reach the interview service. Please try again."})
            reason = "could_not_connect"
            return
        sessions.mark_live(session_id, agent.get_interaction_id())
        await send({"type": "status", "state": "live", "interaction_id": agent.get_interaction_id()})

        async def from_browser() -> str:
            nonlocal mic
            while True:
                msg = await ws.receive_json()
                kind = msg.get("type")
                if kind == "audio" and msg.get("audio"):
                    pcm = base64.b64decode(msg["audio"])
                    if mic is None:
                        sessions.RECORDINGS.mkdir(parents=True, exist_ok=True)
                        mic = wave.open(str(sessions.mic_path(session_id)), "wb")
                        mic.setnchannels(1)
                        mic.setsampwidth(2)
                        mic.setframerate(SAMPLE_RATE)
                        sessions.mark_mic(session_id)
                    mic.writeframes(pcm)
                    chunks = gate.feed(pcm)
                    for event in gate.events:
                        if event == "answer_started":
                            answer_began[:] = [sessions.now(), time.monotonic()]
                            await send({"type": "speech", "state": "start"})
                        else:
                            if answer_began[0]:
                                sessions.add_answer(session_id, answer_began[0], time.monotonic() - answer_began[1])
                            log.info("Interview %s: answer sent to the agent (%.1f s, loudest %d, room %d)",
                                     session_id, (len(chunks) - 1) * 0.1, gate.peak, gate.noise)
                            await send({"type": "speech", "state": "end"})
                    gate.events.clear()
                    for i, chunk in enumerate(chunks):
                        await agent.send_audio(chunk)
                        if len(chunks) > 1 and i % 10 == 9:
                            await asyncio.sleep(0.02)    # a finished answer goes at ~50x real time
                elif kind == "event":
                    n = sessions.add_event(session_id, msg.get("kind", "unknown"), msg.get("detail"))
                    if msg.get("kind") == "tab_switch":
                        if n > limit:
                            return "auto_terminated_tab_switches"
                        await send({"type": "warning", "count": n, "limit": limit})
                # anything else from the candidate (including "end") is ignored

        async def agent_finished() -> str:
            await agent.wait_for_disconnect()
            return "agent_ended"

        async def interviewer_closed() -> str:
            # The agent often says goodbye and then waits. End it for them, once
            # the goodbye has been spoken: no agent audio for CLOSING_QUIET seconds.
            await closing.wait()
            deadline = time.monotonic() + CLOSING_MAX_WAIT
            while time.monotonic() < deadline and time.monotonic() - last_agent_audio[0] < CLOSING_QUIET:
                await asyncio.sleep(0.25)
            return "interviewer_closed"

        async def time_up() -> str:
            await asyncio.sleep(max_seconds)
            return "time_limit"

        tasks = [asyncio.create_task(c) for c in (from_browser(), agent_finished(), interviewer_closed(), time_up())]
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        finished = done.pop()
        reason = finished.result() if not finished.exception() else "connection_lost"
    except WebSocketDisconnect:
        reason = "candidate_left"
    except Exception as exc:  # the service refused us, bad IDs, network, …
        log.exception("Interview %s failed", session_id)
        await send({"type": "error", "message": f"The interview could not continue: {exc}"})
        reason = "error"
    finally:
        await agent.stop()
        if mic is not None:
            mic.close()
        sessions.end(session_id, reason)
        await send({"type": "status", "state": "ended", "reason": reason})
        # Score it from the answers in the background; the candidate doesn't wait.
        if any(t["role"] == "candidate" for t in sessions.get(session_id)["turns"]):
            _schedule_report(session_id)
        try:
            await ws.close()
        except Exception:
            pass
