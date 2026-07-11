"""Tests for summarizer.py's graceful-degradation contract (docs/TESTING.md §agent)."""

from __future__ import annotations

import httpx
import pytest

from summarizer import (
    MAX_TRANSCRIPT_CHARS,
    _TRUNCATION_NOTICE,
    summarize,
)


@pytest.mark.asyncio
async def test_returns_empty_string_when_disabled():
    result = await summarize(
        "some transcript",
        ollama_url="http://localhost:11434",
        ollama_model="qwen2.5:0.5b",
        enabled=False,
    )
    assert result == ""


@pytest.mark.asyncio
async def test_returns_empty_string_for_blank_transcript():
    result = await summarize(
        "   \n  ",
        ollama_url="http://localhost:11434",
        ollama_model="qwen2.5:0.5b",
        enabled=True,
    )
    assert result == ""


@pytest.mark.asyncio
async def test_returns_empty_string_and_does_not_raise_when_ollama_unreachable(monkeypatch):
    async def raise_connect_error(self, *args, **kwargs):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx.AsyncClient, "post", raise_connect_error)

    result = await summarize(
        "hello world",
        ollama_url="http://localhost:11434",
        ollama_model="qwen2.5:0.5b",
        enabled=True,
    )

    assert result == ""


@pytest.mark.asyncio
async def test_returns_empty_string_when_ollama_returns_error_status(monkeypatch):
    async def fake_post(self, *args, **kwargs):
        request = httpx.Request("POST", "http://localhost:11434/api/generate")
        return httpx.Response(500, request=request, json={"error": "boom"})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    result = await summarize(
        "hello world",
        ollama_url="http://localhost:11434",
        ollama_model="qwen2.5:0.5b",
        enabled=True,
    )

    assert result == ""


@pytest.mark.asyncio
async def test_returns_trimmed_summary_on_success(monkeypatch):
    captured_payload = {}

    async def fake_post(self, url, *, json, **kwargs):
        captured_payload["url"] = url
        captured_payload["json"] = json
        request = httpx.Request("POST", url)
        return httpx.Response(200, request=request, json={"response": "  - point one\n- point two  "})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    result = await summarize(
        "hello world",
        ollama_url="http://localhost:11434/",
        ollama_model="qwen2.5:0.5b",
        enabled=True,
    )

    assert result == "- point one\n- point two"
    assert captured_payload["url"] == "http://localhost:11434/api/generate"
    assert captured_payload["json"]["model"] == "qwen2.5:0.5b"
    assert captured_payload["json"]["stream"] is False


@pytest.mark.asyncio
async def test_long_transcript_is_truncated_to_the_tail(monkeypatch):
    captured_payload = {}

    async def fake_post(self, url, *, json, **kwargs):
        captured_payload["json"] = json
        request = httpx.Request("POST", url)
        return httpx.Response(200, request=request, json={"response": "- ok"})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    # A transcript comfortably larger than the cap; the tail must survive.
    head = "OLD " * MAX_TRANSCRIPT_CHARS
    tail = "RECENT-ENDING-MARKER"
    transcript = head + tail

    result = await summarize(
        transcript,
        ollama_url="http://localhost:11434",
        ollama_model="qwen2.5:0.5b",
        enabled=True,
    )

    assert result == "- ok"
    prompt = captured_payload["json"]["prompt"]
    # The tail is preserved and a truncation notice is present; overall prompt
    # stays bounded (transcript portion capped, plus the fixed template/notice).
    assert tail in prompt
    assert _TRUNCATION_NOTICE.strip() in prompt
    assert len(prompt) < len(transcript)
