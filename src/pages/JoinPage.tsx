import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { SessionConfig } from "../types";

const DEFAULT_SERVER_URL = "http://localhost:3001";

/**
 * Join form: serverUrl, roomName, identity, E2EE key + two mutually
 * exclusive toggles (E2EE ⇄ Transcription). See docs/PLAN.md 4.3 / 7.3.
 */
export function JoinPage() {
  const navigate = useNavigate();
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [roomName, setRoomName] = useState("");
  const [identity, setIdentity] = useState("");
  const [e2eeKey, setE2eeKey] = useState("");
  const [e2eeEnabled, setE2eeEnabled] = useState(false);
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(false);

  function handleToggleE2ee(checked: boolean) {
    setE2eeEnabled(checked);
    if (checked) {
      setTranscriptionEnabled(false);
    }
  }

  function handleToggleTranscription(checked: boolean) {
    setTranscriptionEnabled(checked);
    if (checked) {
      setE2eeEnabled(false);
      setE2eeKey("");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!roomName.trim() || !identity.trim() || !serverUrl.trim()) {
      return;
    }

    const config: SessionConfig = {
      serverUrl: serverUrl.trim(),
      roomName: roomName.trim(),
      identity: identity.trim(),
      e2eeKey: e2eeEnabled && e2eeKey.trim() ? e2eeKey.trim() : undefined,
      transcriptionEnabled,
    };

    navigate("/room", { state: config });
  }

  return (
    <main className="join-page">
      <h1>Join a call</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Token server URL
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.currentTarget.value)}
            placeholder="http://localhost:3001"
            required
          />
        </label>

        <label>
          Room name
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.currentTarget.value)}
            placeholder="my-room"
            required
          />
        </label>

        <label>
          Identity
          <input
            value={identity}
            onChange={(e) => setIdentity(e.currentTarget.value)}
            placeholder="your-name"
            required
          />
        </label>

        <fieldset>
          <legend>Options</legend>

          <label title="Транскрипция недоступна при включённом E2EE">
            <input
              type="checkbox"
              checked={e2eeEnabled}
              onChange={(e) => handleToggleE2ee(e.currentTarget.checked)}
            />
            End-to-end encryption
          </label>

          {e2eeEnabled && (
            <input
              type="password"
              value={e2eeKey}
              onChange={(e) => setE2eeKey(e.currentTarget.value)}
              placeholder="E2EE key"
            />
          )}

          <label title="Транскрипция недоступна при включённом E2EE">
            <input
              type="checkbox"
              checked={transcriptionEnabled}
              onChange={(e) => handleToggleTranscription(e.currentTarget.checked)}
              disabled={e2eeEnabled}
            />
            Transcription
          </label>
        </fieldset>

        <button type="submit">Join</button>
      </form>
    </main>
  );
}
