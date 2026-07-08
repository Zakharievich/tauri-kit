import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { generateE2EEKey } from "../services/e2eeService";
import type { SessionConfig } from "../types";

const DEFAULT_SERVER_URL = "http://localhost:3001";

/**
 * Join form: serverUrl, roomName, identity, E2EE key + two mutually
 * exclusive toggles (E2EE ⇄ Transcription). See docs/PLAN.md 4.3 / 7.3.
 *
 * Host flow: clicking "Сгенерировать секретный ключ" creates a random E2EE
 * key locally via `crypto.getRandomValues()` (see e2eeService.generateE2EEKey)
 * and displays it so it can be copied and shared with participants
 * out-of-band. The key is never sent to the token server and never logged
 * (HIGH RISK 4.2).
 */
export function JoinPage() {
  const navigate = useNavigate();
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [roomName, setRoomName] = useState("");
  const [identity, setIdentity] = useState("");
  const [e2eeKey, setE2eeKey] = useState("");
  const [e2eeEnabled, setE2eeEnabled] = useState(false);
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  function handleToggleE2ee(checked: boolean) {
    setE2eeEnabled(checked);
    if (checked) {
      setTranscriptionEnabled(false);
    } else {
      setE2eeKey("");
      setKeyCopied(false);
    }
  }

  function handleToggleTranscription(checked: boolean) {
    setTranscriptionEnabled(checked);
    if (checked) {
      setE2eeEnabled(false);
      setE2eeKey("");
    }
  }

  function handleGenerateKey() {
    setE2eeKey(generateE2EEKey());
    setKeyCopied(false);
  }

  async function handleCopyKey() {
    try {
      await navigator.clipboard.writeText(e2eeKey);
      setKeyCopied(true);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context); the key
      // is still visible in the input for manual copying.
      setKeyCopied(false);
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
      <form className="join-page__form" onSubmit={handleSubmit}>
        <label className="join-page__field">
          <span className="join-page__label">URL сервера</span>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.currentTarget.value)}
            placeholder="http://localhost:3001"
            required
          />
        </label>

        <label className="join-page__field">
          <span className="join-page__label">Имя комнаты</span>
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.currentTarget.value)}
            placeholder="my-room"
            required
          />
        </label>

        <label className="join-page__field">
          <span className="join-page__label">Ваше имя</span>
          <input
            value={identity}
            onChange={(e) => setIdentity(e.currentTarget.value)}
            placeholder="your-name"
            required
          />
        </label>

        <fieldset className="join-page__options">
          <legend>Опции</legend>

          <label className="join-page__checkbox" title="Транскрипция недоступна при включённом шифровании">
            <input
              type="checkbox"
              checked={e2eeEnabled}
              onChange={(e) => handleToggleE2ee(e.currentTarget.checked)}
            />
            Шифрование
          </label>

          {e2eeEnabled && (
            <div className="e2ee-key-field">
              <input
                type="text"
                value={e2eeKey}
                onChange={(e) => {
                  setE2eeKey(e.currentTarget.value);
                  setKeyCopied(false);
                }}
                placeholder="Вставьте E2EE ключ"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="e2ee-key-field__buttons">
                <button type="button" onClick={handleGenerateKey}>
                  Сгенерировать секретный ключ
                </button>
                {e2eeKey && (
                  <button type="button" onClick={() => void handleCopyKey()}>
                    {keyCopied ? "Скопировано!" : "Копировать"}
                  </button>
                )}
              </div>
            </div>
          )}

          <label className="join-page__checkbox" title="Транскрипция недоступна при включённом шифровании">
            <input
              type="checkbox"
              checked={transcriptionEnabled}
              onChange={(e) => handleToggleTranscription(e.currentTarget.checked)}
              disabled={e2eeEnabled}
            />
            Транскрибация речи
          </label>
        </fieldset>

        <button type="submit" className="join-page__submit">
          Присоединиться
        </button>
      </form>
    </main>
  );
}
