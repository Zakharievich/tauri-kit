"""Entrypoint for the optional Python LiveKit transcription agent.

Responsibility (SRP, docs/PLAN.md §9.4): read configuration/flags, join the
room as a hidden participant, wire `Transcriber` to incoming audio, and on
session end orchestrate `Summarizer` + `Exporter` to deliver the final
transcript. No STT/summary/formatting business logic lives here.

Startup behavior:
- `ENABLE_STT=false` -> log a warning and exit immediately, without joining
  the room (docs/PLAN.md §5 matrix: no E2EE conflict possible, this is a
  pure opt-out).
- Otherwise, connects as identity `agent-transcriber` with
  `AutoSubscribe.AUDIO_ONLY` and *never* publishes any track of its own —
  it is a "hidden" participant purely for transcription purposes.
"""

from __future__ import annotations

import asyncio
import logging
import os

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli

from exporter import build_document, publish_final
from summarizer import summarize
from transcriber import Transcriber

logger = logging.getLogger("agent.main")

AGENT_IDENTITY = "agent-transcriber"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


class AgentConfig:
    """Typed, fail-fast snapshot of the agent's environment configuration
    (docs/PLAN.md §9.3)."""

    def __init__(self) -> None:
        self.enable_stt = _env_bool("ENABLE_STT", True)
        self.enable_summary = _env_bool("ENABLE_SUMMARY", True)
        self.faster_whisper_url = os.getenv(
            "FASTER_WHISPER_URL", "http://localhost:8000/v1"
        )
        self.faster_whisper_model = os.getenv("FASTER_WHISPER_MODEL", "tiny")
        self.ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        self.ollama_model = os.getenv("OLLAMA_MODEL", "qwen2.5:0.5b")


async def _run_session(ctx: JobContext, config: AgentConfig) -> None:
    """Joins the room as a hidden participant, transcribes audio for the
    lifetime of the session, then exports the final document."""
    transcriber = Transcriber(
        whisper_url=config.faster_whisper_url,
        whisper_model=config.faster_whisper_model,
    )

    def _subscribe_track(track: rtc.Track, participant: rtc.RemoteParticipant) -> None:
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return

        audio_stream = rtc.AudioStream(track)

        async def _consume() -> None:
            async for event in audio_stream:
                await transcriber.push_frame(participant.identity, event.frame)

        asyncio.create_task(_consume())

    @ctx.room.on("track_subscribed")
    def _on_track_subscribed(
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,  # noqa: ARG001 - required by event signature
        participant: rtc.RemoteParticipant,
    ) -> None:
        _subscribe_track(track, participant)

    shutdown_event = asyncio.Event()

    async def _on_shutdown(reason: str) -> None:  # noqa: ARG001 - required by callback signature
        shutdown_event.set()

    ctx.add_shutdown_callback(_on_shutdown)

    try:
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        logger.info("Agent connected to room %s as %s", ctx.room.name, AGENT_IDENTITY)

        # Runs until the job is torn down (last participant left / room closed).
        # `JobContext` has no `wait_for_shutdown()`; shutdown is signalled via
        # `add_shutdown_callback`, so we wait on an event set by that callback.
        await shutdown_event.wait()
    finally:
        await transcriber.flush_all()

        transcript_text = transcriber.get_transcript_text() or build_document(
            transcriber.segments
        )

        summary_text = await summarize(
            transcript_text,
            ollama_url=config.ollama_url,
            ollama_model=config.ollama_model,
            enabled=config.enable_summary,
        )


        await publish_final(ctx.room, transcript_text, summary_text)
        await transcriber.aclose()


async def entrypoint(ctx: JobContext) -> None:
    config = AgentConfig()

    if not config.enable_stt:
        logger.warning(
            "ENABLE_STT=false — agent will not join room %s", ctx.room.name
        )
        return

    await _run_session(ctx, config)


def main() -> None:
    load_dotenv()
    logging.basicConfig(level=logging.INFO)

    if not _env_bool("ENABLE_STT", True):
        logger.warning("ENABLE_STT=false — agent exiting at startup")
        return

    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            ws_url=os.getenv("LIVEKIT_URL"),
            api_key=os.getenv("LIVEKIT_API_KEY"),
            api_secret=os.getenv("LIVEKIT_API_SECRET"),
        )
    )


if __name__ == "__main__":
    main()
