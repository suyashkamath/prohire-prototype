"""The live interview: browser ⇄ this server ⇄ Sarvam agent.

The browser never talks to Sarvam and never sees the API key. It streams the
candidate's microphone (16 kHz, 16-bit PCM, base64) to this server over a
WebSocket; the server passes it to the Sarvam agent and sends the agent's voice,
transcripts and events back.

Messages from the browser:   {"type": "audio", "audio": "<base64 pcm>"}
                             {"type": "event", "kind": "tab_switch"}
                             {"type": "end"}
Messages to the browser:     {"type": "status", "state": "connecting|live|ended", ...}
                             {"type": "audio", "audio": "<base64>", "sample_rate": 16000}
                             {"type": "transcript", "role": "interviewer|candidate", "text": "..."}
                             {"type": "speech", "state": "start|end"}   (candidate speaking)
                             {"type": "interrupt"}                     (stop playing the agent)
                             {"type": "warning", "count": n, "limit": m}
                             {"type": "error", "message": "..."}
"""

import asyncio
import base64
import logging

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
from sarvam_conv_ai_sdk.messages.events import (
    ServerInteractionConnectedEvent,
    ServerUserSpeechEndMsg,
    ServerUserSpeechStartMsg,
)
from sarvam_conv_ai_sdk.messages.types import UserIdentifierType

from . import agent_vars, sessions
from .settings import load

log = logging.getLogger("interviewbot.bridge")
SAMPLE_RATE = 16000


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

    settings = load()
    if settings.missing():
        await send({"type": "error", "message": f"The server is missing: {', '.join(settings.missing())}. Add them to .env."})
        await ws.close()
        return

    plan = session["plan"]
    limit = int(plan["settings"].get("max_tab_switches", 3))

    async def on_audio(msg: ServerAudioChunkMsg) -> None:
        if msg.audio_base64:
            await send({"type": "audio", "audio": msg.audio_base64, "sample_rate": msg.sample_rate or SAMPLE_RATE})

    async def on_transcript(msg: ServerTranscriptMsg) -> None:
        role = "candidate" if msg.role == Role.USER else "interviewer"
        turn = sessions.add_turn(session_id, role, msg.content)
        await send({"type": "transcript", **turn})

    async def on_event(event: ServerEventBase) -> None:
        if isinstance(event, ServerInteractionConnectedEvent):
            sessions.mark_live(session_id, event.interaction_id)
        elif isinstance(event, ServerUserInterruptEvent):
            await send({"type": "interrupt"})
        elif isinstance(event, ServerUserSpeechStartMsg):
            await send({"type": "speech", "state": "start"})
        elif isinstance(event, ServerUserSpeechEndMsg):
            await send({"type": "speech", "state": "end"})
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
            while True:
                msg = await ws.receive_json()
                kind = msg.get("type")
                if kind == "audio" and msg.get("audio"):
                    await agent.send_audio(base64.b64decode(msg["audio"]))
                elif kind == "event":
                    n = sessions.add_event(session_id, msg.get("kind", "unknown"), msg.get("detail"))
                    if msg.get("kind") == "tab_switch":
                        if n > limit:
                            return "auto_terminated_tab_switches"
                        await send({"type": "warning", "count": n, "limit": limit})
                elif kind == "end":
                    return "candidate_ended"

        async def agent_finished() -> str:
            await agent.wait_for_disconnect()
            return "agent_ended"

        tasks = [asyncio.create_task(from_browser()), asyncio.create_task(agent_finished())]
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
        sessions.end(session_id, reason)
        await send({"type": "status", "state": "ended", "reason": reason})
        try:
            await ws.close()
        except Exception:
            pass
