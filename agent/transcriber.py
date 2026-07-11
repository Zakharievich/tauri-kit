"""STT logic: buffers participant audio, sends it to faster-whisper-server
and accumulates timestamped transcript segments.

Single responsibility: turn audio frames into text segments. Knows nothing
about Ollama or the LiveKit DataChannel — those live in `summarizer.py` and
`exporter.py` respectively (SOLID / SRP, see .clinerules).

Graceful degradation (HIGH RISK 4.3, docs/PLAN.md §9.4): if
faster-whisper-server is unreachable or returns an error, the failure is
logged as a warning and the audio chunk is simply dropped — the agent never
crashes because of a transient STT failure.
"""

from __future__ import annotations

import asyncio
import io
import logging
import time
import wave
from dataclasses import dataclass, field

import httpx
from livekit import rtc

logger = logging.getLogger("agent.transcriber")

# How many seconds of audio to buffer per participant before sending a chunk
# to faster-whisper-server. A larger window improves transcription quality
# at the cost of latency; tiny model is fast enough for this trade-off.
CHUNK_DURATION_SECONDS = 5.0

# Hard cap on how much audio a single participant may buffer. Transcription
# runs in the background (see `_schedule_flush`); if the STT backend is slow or
# stalled, incoming frames keep accumulating. Beyond this cap we drop the
# oldest frames rather than grow memory without bound — losing a little audio
# under a degraded backend is acceptable (same graceful-degradation contract as
# a dropped chunk in `_flush`, HIGH RISK 4.3).
MAX_BUFFERED_SECONDS = 30.0

# Timeout for a single HTTP request to faster-whisper-server.
REQUEST_TIMEOUT_SECONDS = 30.0


@dataclass
class TranscriptSegment:
    """A single utterance produced by the STT backend."""

    participant_identity: str
    text: str
    offset_seconds: float

    def format(self) -> str:
        """Render as `[HH:MM:SS] text`, per docs/PLAN.md §9.4."""
        hours, remainder = divmod(int(self.offset_seconds), 3600)
        minutes, seconds = divmod(remainder, 60)
        timestamp = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        return f"[{timestamp}] {self.text}"


@dataclass
class _ParticipantBuffer:
    """Accumulates raw PCM audio frames for one participant until a chunk is
    ready to be sent to the STT backend."""

    sample_rate: int
    num_channels: int
    frames: list[bytes] = field(default_factory=list)
    frame_durations: list[float] = field(default_factory=list)
    buffered_seconds: float = 0.0
    # True while a background flush of this buffer is in flight, so `push_frame`
    # never starts a second, overlapping flush for the same participant.
    flushing: bool = False

    def add(self, frame: rtc.AudioFrame) -> None:
        self.frames.append(bytes(frame.data))
        duration = frame.samples_per_channel / frame.sample_rate
        self.frame_durations.append(duration)
        self.buffered_seconds += duration
        self._drop_oldest_over_cap()

    def _drop_oldest_over_cap(self) -> None:
        """Bounds memory: while over the cap, discard the oldest frames (keeping
        at least one) so a slow/stalled STT backend can't grow the buffer
        without limit."""
        if self.buffered_seconds <= MAX_BUFFERED_SECONDS:
            return
        dropped = 0
        while self.buffered_seconds > MAX_BUFFERED_SECONDS and len(self.frames) > 1:
            self.frames.pop(0)
            self.buffered_seconds -= self.frame_durations.pop(0)
            dropped += 1
        if dropped:
            logger.warning(
                "STT backend not keeping up — dropped %d oldest audio frame(s) "
                "to stay under the %.0fs buffer cap",
                dropped,
                MAX_BUFFERED_SECONDS,
            )

    def is_ready(self) -> bool:
        return self.buffered_seconds >= CHUNK_DURATION_SECONDS

    def pop_wav_bytes(self) -> bytes:
        """Encodes the buffered PCM frames as a WAV file and resets state."""
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(self.num_channels)
            wav_file.setsampwidth(2)  # LiveKit audio frames are 16-bit PCM
            wav_file.setframerate(self.sample_rate)
            wav_file.writeframes(b"".join(self.frames))
        self.frames.clear()
        self.frame_durations.clear()
        self.buffered_seconds = 0.0
        return buffer.getvalue()


class Transcriber:
    """Accumulates transcript segments for an entire session by forwarding
    buffered participant audio to faster-whisper-server."""

    def __init__(self, whisper_url: str, whisper_model: str) -> None:
        self._whisper_url = whisper_url.rstrip("/")
        self._whisper_model = whisper_model
        self._session_start = time.monotonic()
        self._segments: list[TranscriptSegment] = []
        self._buffers: dict[str, _ParticipantBuffer] = {}
        self._client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS)
        # In-flight background flush tasks, so we never block frame intake on a
        # slow STT request and can await them all at shutdown.
        self._flush_tasks: set[asyncio.Task[None]] = set()

    async def aclose(self) -> None:
        await self.wait_for_pending_flushes()
        await self._client.aclose()

    def _offset_seconds(self) -> float:
        return time.monotonic() - self._session_start

    async def push_frame(self, participant_identity: str, frame: rtc.AudioFrame) -> None:
        """Buffers one audio frame for a participant; kicks off a background
        flush to STT once enough audio has accumulated. Never blocks on the STT
        request itself — a slow backend must not stall audio intake."""
        buffer = self._buffers.get(participant_identity)
        if buffer is None:
            buffer = _ParticipantBuffer(
                sample_rate=frame.sample_rate,
                num_channels=frame.num_channels,
            )
            self._buffers[participant_identity] = buffer

        buffer.add(frame)
        if buffer.is_ready() and not buffer.flushing:
            self._schedule_flush(participant_identity, buffer)

    def _schedule_flush(self, participant_identity: str, buffer: _ParticipantBuffer) -> None:
        """Runs a flush in the background and tracks the task so shutdown can
        await it. `buffer.flushing` guards against overlapping flushes."""
        buffer.flushing = True
        task = asyncio.create_task(self._flush(participant_identity, buffer))
        self._flush_tasks.add(task)
        task.add_done_callback(self._flush_tasks.discard)

    async def wait_for_pending_flushes(self) -> None:
        """Awaits any in-flight background flushes. Idempotent; safe to call at
        shutdown or from tests that need a deterministic point after intake."""
        if self._flush_tasks:
            await asyncio.gather(*list(self._flush_tasks), return_exceptions=True)

    async def _flush(self, participant_identity: str, buffer: _ParticipantBuffer) -> None:
        try:
            wav_bytes = buffer.pop_wav_bytes()
            offset = self._offset_seconds()

            try:
                text = await self._transcribe_chunk(wav_bytes)
            except Exception:  # noqa: BLE001 - graceful degradation, never crash
                logger.warning(
                    "faster-whisper-server unavailable, dropping audio chunk for %s",
                    participant_identity,
                    exc_info=True,
                )
                return

            text = text.strip()
            if not text:
                return

            segment = TranscriptSegment(
                participant_identity=participant_identity,
                text=text,
                offset_seconds=offset,
            )
            self._segments.append(segment)
            logger.info("Transcribed segment: %s", segment.format())
        finally:
            buffer.flushing = False

    async def _transcribe_chunk(self, wav_bytes: bytes) -> str:
        """Calls the OpenAI-compatible `/audio/transcriptions` endpoint of
        faster-whisper-server (docs/PLAN.md §9.3/9.4) with
        `model=tiny` (configurable via `FASTER_WHISPER_MODEL`) and
        `response_format=json`, per the task spec."""
        response = await self._client.post(
            f"{self._whisper_url}/audio/transcriptions",
            data={
                "model": self._whisper_model,
                "response_format": "json",
            },
            files={"file": ("chunk.wav", wav_bytes, "audio/wav")},
        )
        response.raise_for_status()
        payload = response.json()
        return payload.get("text", "")

    async def flush_all(self) -> None:
        """Flushes any remaining buffered audio for all participants. Call
        this once at session end so the tail of the conversation is not
        lost."""
        # First let any background flush already in flight finish, so we don't
        # race it or double-send the same audio.
        await self.wait_for_pending_flushes()
        for identity, buffer in list(self._buffers.items()):
            if buffer.buffered_seconds > 0:
                buffer.flushing = True
                await self._flush(identity, buffer)

    def get_transcript_text(self) -> str:
        """Full transcript text, one formatted segment per line — this is
        `payload.transcript` in the `transcript_final` message
        (docs/PLAN.md §7.2)."""
        return "\n".join(segment.format() for segment in self._segments)

    @property
    def segments(self) -> list[TranscriptSegment]:
        return list(self._segments)
