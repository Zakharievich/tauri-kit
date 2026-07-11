"""Optional summary generation via a local Ollama instance.

Single responsibility: turn a transcript into a short bullet-point summary.
Knows nothing about STT or the LiveKit DataChannel (SOLID / SRP).

Graceful degradation (HIGH RISK 4.3, docs/PLAN.md §9.4): if Ollama is
unreachable, times out, or returns an error, a warning is logged and an
empty string is returned. The final document is then published without a
summary — the agent never crashes because of Ollama being unavailable.
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger("agent.summarizer")

REQUEST_TIMEOUT_SECONDS = 60.0

# Upper bound on how much transcript text we feed into the summary prompt. A
# whole-meeting transcript can grow large; sending all of it inflates memory,
# Ollama latency and context usage for little gain. We keep the most recent
# text (the tail), which is what a short wrap-up summary cares about most.
MAX_TRANSCRIPT_CHARS = 12000

_TRUNCATION_NOTICE = "[…earlier transcript omitted…]\n"

PROMPT_TEMPLATE = (
    "Summarize the following call transcript in 3 to 5 concise bullet "
    "points, written in the same language as the transcript. Only output "
    "the bullet points, no preamble.\n\n"
    "Transcript:\n{transcript}"
)


def _truncate_transcript(transcript_text: str) -> str:
    """Keeps the last MAX_TRANSCRIPT_CHARS characters, prefixed with a notice
    when anything was dropped. Returns the text unchanged when within bounds."""
    if len(transcript_text) <= MAX_TRANSCRIPT_CHARS:
        return transcript_text
    return _TRUNCATION_NOTICE + transcript_text[-MAX_TRANSCRIPT_CHARS:]


async def summarize(
    transcript_text: str,
    *,
    ollama_url: str,
    ollama_model: str,
    enabled: bool,
) -> str:
    """Requests a 3-5 bullet-point summary from Ollama.

    Returns an empty string when summarization is disabled, the transcript
    is empty, or Ollama is unavailable — never raises (docs/PLAN.md §9.4).
    """
    if not enabled:
        return ""

    if not transcript_text.strip():
        logger.info("Empty transcript, skipping summary request")
        return ""

    prompt = PROMPT_TEMPLATE.format(transcript=_truncate_transcript(transcript_text))

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{ollama_url.rstrip('/')}/api/generate",
                json={
                    "model": ollama_model,
                    "prompt": prompt,
                    "stream": False,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:  # noqa: BLE001 - graceful degradation, never crash
        logger.warning(
            "Ollama unavailable at %s, publishing transcript without a summary",
            ollama_url,
            exc_info=True,
        )
        return ""

    summary = payload.get("response", "")
    return summary.strip()
