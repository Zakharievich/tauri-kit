"""Final document formatting and delivery over the LiveKit DataChannel.

Single responsibility: turn accumulated transcript segments (+ optional
summary) into the final document and publish it to every participant in
the room. Knows nothing about STT or Ollama (SOLID / SRP).

`publish_final()` wraps the transcript/summary in the fixed `AgentMessage`
JSON envelope (docs/PLAN.md §7.2):

    {
      "type": "transcript_final",
      "version": 1,
      "payload": { "transcript": "...", "summary": "..." }
    }

This is the canonical wire format actually sent over the DataChannel and
already parsed by the frontend (`src/hooks/useTranscription.ts`).
`summary` is always present as a string — an empty string `""` means no
summary is available (disabled via ENABLE_SUMMARY or Ollama was
unreachable), never `null`/omitted, so the frontend contract stays simple.
"""

from __future__ import annotations

import json
import logging

from livekit import rtc

logger = logging.getLogger("agent.exporter")

TRANSCRIPT_FINAL_TOPIC = "transcript_final"
AGENT_MESSAGE_VERSION = 1


def build_document(segments: list) -> str:
    """Joins already-formatted `[HH:MM:SS] text` segments into the final
    transcript body. Accepts objects exposing a `.format()` method (see
    `transcriber.TranscriptSegment`) to avoid a hard import-time dependency
    on `transcriber.py`.
    """
    return "\n".join(segment.format() for segment in segments)


def _build_payload(transcript: str, summary: str) -> dict:
    return {
        "type": TRANSCRIPT_FINAL_TOPIC,
        "version": AGENT_MESSAGE_VERSION,
        "payload": {
            "transcript": transcript,
            "summary": summary or "",
        },
    }


async def publish_final(room: rtc.Room, transcript: str, summary: str) -> None:
    """Publishes the final transcript document to every participant in the
    room via a reliable DataChannel message on the `transcript_final` topic
    (docs/PLAN.md §7.2).

    Best-effort: if publishing fails (e.g. room already closing), the error
    is logged and swallowed — the agent is shutting down anyway and must not
    crash on the way out.
    """
    message = _build_payload(transcript, summary)
    data = json.dumps(message).encode("utf-8")

    try:
        await room.local_participant.publish_data(
            data,
            reliable=True,
            topic=TRANSCRIPT_FINAL_TOPIC,
        )
        logger.info("Published final transcript (%d bytes)", len(data))
    except Exception:  # noqa: BLE001 - best-effort delivery on shutdown
        logger.warning("Failed to publish final transcript", exc_info=True)
