"""Tests for main.py's ENABLE_STT=false opt-out path (docs/PLAN.md §5,
docs/TESTING.md §agent) — the agent must not join the room or start a
worker at all when transcription is disabled."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

import main


def test_env_bool_parses_common_truthy_and_falsy_strings(monkeypatch):
    for truthy in ("1", "true", "True", "yes", "on"):
        monkeypatch.setenv("FLAG", truthy)
        assert main._env_bool("FLAG", False) is True

    for falsy in ("0", "false", "False", "no", "off", ""):
        monkeypatch.setenv("FLAG", falsy)
        assert main._env_bool("FLAG", True) is False

    monkeypatch.delenv("FLAG", raising=False)
    assert main._env_bool("FLAG", True) is True
    assert main._env_bool("FLAG", False) is False


@pytest.mark.asyncio
async def test_entrypoint_does_not_join_room_when_stt_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_STT", "false")

    connect_calls = []

    async def fake_connect(*args, **kwargs):
        connect_calls.append((args, kwargs))

    fake_ctx = SimpleNamespace(room=SimpleNamespace(name="test-room"), connect=fake_connect)

    await main.entrypoint(fake_ctx)

    assert connect_calls == []


def test_main_does_not_start_worker_when_stt_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_STT", "false")

    def fail_if_called(*args, **kwargs):
        raise AssertionError("cli.run_app should not be called when ENABLE_STT=false")

    monkeypatch.setattr(main.cli, "run_app", fail_if_called)
    monkeypatch.setattr(main, "load_dotenv", lambda: None)

    main.main()  # must return normally, without touching cli.run_app
