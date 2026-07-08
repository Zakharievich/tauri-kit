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

PROMPT_TEMPLATE = (
    "Summarize the following call transcript in 3 to 5 concise bullet "
    "points, written in the same language as the transcript. Only output "
    "the bullet points, no preamble.\n\n"
    "Transcript:\n{transcript}"
)


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

    prompt = PROMPT_TEMPLATE.format(transcript=transcript_text)

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
