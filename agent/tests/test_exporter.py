"""Tests for exporter.py: document assembly and the transcript_final wire
contract (docs/PLAN.md §7.2, docs/TESTING.md §agent)."""

from __future__ import annotations

import json
from dataclasses import dataclass

import pytest

from exporter import AGENT_MESSAGE_VERSION, TRANSCRIPT_FINAL_TOPIC, build_document, publish_final


@dataclass
class FakeSegment:
    text: str

    def format(self) -> str:
        return f"[00:00:00] {self.text}"


class FakeLocalParticipant:
    def __init__(self, *, raise_on_publish: bool = False):
        self.raise_on_publish = raise_on_publish
        self.published: list[dict] = []

    async def publish_data(self, data: bytes, *, reliable: bool, topic: str):
        if self.raise_on_publish:
            raise ConnectionError("room already closing")
        self.published.append({"data": data, "reliable": reliable, "topic": topic})


class FakeRoom:
    def __init__(self, *, raise_on_publish: bool = False):
        self.local_participant = FakeLocalParticipant(raise_on_publish=raise_on_publish)


def test_build_document_joins_formatted_segments():
    segments = [FakeSegment("hello"), FakeSegment("world")]
    assert build_document(segments) == "[00:00:00] hello\n[00:00:00] world"


def test_build_document_handles_no_segments():
    assert build_document([]) == ""


@pytest.mark.asyncio
async def test_publish_final_sends_correctly_shaped_envelope():
    room = FakeRoom()

    await publish_final(room, "hello world", "a short summary")

    assert len(room.local_participant.published) == 1
    call = room.local_participant.published[0]
    assert call["reliable"] is True
    assert call["topic"] == TRANSCRIPT_FINAL_TOPIC == "transcript_final"

    message = json.loads(call["data"])
    assert message == {
        "type": "transcript_final",
        "version": AGENT_MESSAGE_VERSION,
        "payload": {"transcript": "hello world", "summary": "a short summary"},
    }


@pytest.mark.asyncio
async def test_publish_final_defaults_summary_to_empty_string_when_falsy():
    room = FakeRoom()

    await publish_final(room, "hello world", "")

    message = json.loads(room.local_participant.published[0]["data"])
    assert message["payload"]["summary"] == ""


@pytest.mark.asyncio
async def test_publish_final_swallows_errors_instead_of_raising():
    room = FakeRoom(raise_on_publish=True)

    # Must not raise — the agent is shutting down anyway and must not crash
    # on the way out (best-effort delivery).
    await publish_final(room, "hello world", "")
