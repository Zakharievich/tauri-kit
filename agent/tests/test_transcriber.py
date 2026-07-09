"""Tests for transcriber.py's graceful-degradation contract (docs/TESTING.md §agent)."""

from __future__ import annotations

import httpx
import pytest

from transcriber import Transcriber, TranscriptSegment


class FakeAudioFrame:
    """Duck-typed stand-in for `livekit.rtc.AudioFrame` — `_ParticipantBuffer.add()`
    only touches `.data`, `.samples_per_channel` and `.sample_rate`, so a real
    (native) AudioFrame isn't needed for these unit tests."""

    def __init__(self, data: bytes, sample_rate: int = 48000, num_channels: int = 1, samples_per_channel: int = 48000):
        self.data = data
        self.sample_rate = sample_rate
        self.num_channels = num_channels
        self.samples_per_channel = samples_per_channel


def make_transcriber() -> Transcriber:
    return Transcriber(whisper_url="http://localhost:8000/v1", whisper_model="tiny")


def test_transcript_segment_format_pads_timestamp():
    segment = TranscriptSegment(participant_identity="alice", text="hello", offset_seconds=65)
    assert segment.format() == "[00:01:05] hello"


@pytest.mark.asyncio
async def test_push_frame_drops_chunk_and_stays_alive_when_stt_unreachable(monkeypatch):
    transcriber = make_transcriber()

    async def raise_connect_error(self, *args, **kwargs):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx.AsyncClient, "post", raise_connect_error)

    # One frame with enough samples to immediately cross CHUNK_DURATION_SECONDS.
    frame = FakeAudioFrame(data=b"\x00\x00" * 48000, sample_rate=48000, samples_per_channel=48000 * 6)

    await transcriber.push_frame("alice", frame)

    assert transcriber.get_transcript_text() == ""
    assert transcriber.segments == []

    await transcriber.aclose()


@pytest.mark.asyncio
async def test_push_frame_records_segment_on_successful_transcription(monkeypatch):
    transcriber = make_transcriber()

    async def fake_post(self, url, *, data, files, **kwargs):
        request = httpx.Request("POST", url)
        return httpx.Response(200, request=request, json={"text": "hello there"})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    frame = FakeAudioFrame(data=b"\x00\x00" * 48000, sample_rate=48000, samples_per_channel=48000 * 6)
    await transcriber.push_frame("alice", frame)

    assert "hello there" in transcriber.get_transcript_text()
    assert len(transcriber.segments) == 1
    assert transcriber.segments[0].participant_identity == "alice"

    await transcriber.aclose()


@pytest.mark.asyncio
async def test_empty_transcription_result_produces_no_segment(monkeypatch):
    transcriber = make_transcriber()

    async def fake_post(self, url, *, data, files, **kwargs):
        request = httpx.Request("POST", url)
        return httpx.Response(200, request=request, json={"text": "   "})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    frame = FakeAudioFrame(data=b"\x00\x00" * 48000, sample_rate=48000, samples_per_channel=48000 * 6)
    await transcriber.push_frame("alice", frame)

    assert transcriber.segments == []

    await transcriber.aclose()


@pytest.mark.asyncio
async def test_flush_all_sends_remaining_buffered_audio_below_threshold(monkeypatch):
    transcriber = make_transcriber()
    call_count = 0

    async def fake_post(self, url, *, data, files, **kwargs):
        nonlocal call_count
        call_count += 1
        request = httpx.Request("POST", url)
        return httpx.Response(200, request=request, json={"text": "tail of the conversation"})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    # Below CHUNK_DURATION_SECONDS (5s) — push_frame alone should not flush.
    frame = FakeAudioFrame(data=b"\x00\x00" * 100, sample_rate=48000, samples_per_channel=100)
    await transcriber.push_frame("alice", frame)
    assert call_count == 0
    assert transcriber.segments == []

    await transcriber.flush_all()

    assert call_count == 1
    assert len(transcriber.segments) == 1
    assert "tail of the conversation" in transcriber.get_transcript_text()

    await transcriber.aclose()
