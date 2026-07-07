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

    def as_dict(self) -> dict:
        """Render as `{"timestamp": "HH:MM:SS", "text": "..."}`, matching the
        task spec's segment shape."""
        hours, remainder = divmod(int(self.offset_seconds), 3600)
        minutes, seconds = divmod(remainder, 60)
        timestamp = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        return {"timestamp": timestamp, "text": self.text}


@dataclass
class _ParticipantBuffer:
    """Accumulates raw PCM audio frames for one participant until a chunk is
    ready to be sent to the STT backend."""

    sample_rate: int
    num_channels: int
    frames: list[bytes] = field(default_factory=list)
    buffered_seconds: float = 0.0

    def add(self, frame: rtc.AudioFrame) -> None:
        self.frames.append(bytes(frame.data))
        self.buffered_seconds += frame.samples_per_channel / frame.sample_rate

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

    async def aclose(self) -> None:
        await self._client.aclose()

    def _offset_seconds(self) -> float:
        return time.monotonic() - self._session_start

    async def push_frame(self, participant_identity: str, frame: rtc.AudioFrame) -> None:
        """Buffers one audio frame for a participant; flushes to STT once
        enough audio has accumulated."""
        buffer = self._buffers.get(participant_identity)
        if buffer is None:
            buffer = _ParticipantBuffer(
                sample_rate=frame.sample_rate,
                num_channels=frame.num_channels,
            )
            self._buffers[participant_identity] = buffer

        buffer.add(frame)
        if buffer.is_ready():
            await self._flush(participant_identity, buffer)

    async def _flush(self, participant_identity: str, buffer: _ParticipantBuffer) -> None:
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
        for identity, buffer in list(self._buffers.items()):
            if buffer.buffered_seconds > 0:
                await self._flush(identity, buffer)

    def get_transcript_text(self) -> str:
        """Full transcript text, one formatted segment per line — this is
        `payload.transcript` in the `transcript_final` message
        (docs/PLAN.md §7.2)."""
        return "\n".join(segment.format() for segment in self._segments)

    def get_transcript(self) -> str:
        """Formatted transcript string, per the task spec
        (`Transcriber.get_transcript() -> str`). Alias of
        `get_transcript_text()`, kept for naming compatibility with
        docs/PLAN.md and the task description."""
        return self.get_transcript_text()

    def get_segments(self) -> list[dict]:
        """Accumulated segments as `{"timestamp": "HH:MM:SS", "text": "..."}`
        dicts, per the task spec's segment shape."""
        return [segment.as_dict() for segment in self._segments]

    @property
    def segments(self) -> list[TranscriptSegment]:
        return list(self._segments)
