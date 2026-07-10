import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { generateE2EEKey } from "../services/e2eeService";
import { generateRoomName, parseInviteLink } from "../services/inviteLink";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import type { SessionConfig } from "../types";

/** localStorage key for remembering the last-used join settings. The E2EE key
 *  is deliberately NOT persisted (HIGH RISK 4.2 — must not touch disk). */
const STORAGE_KEY = "tauri-kit:join";

type PersistedJoin = {
  serverUrl?: string;
  identity?: string;
  e2eeEnabled?: boolean;
  transcriptionEnabled?: boolean;
};

function loadPersisted(): PersistedJoin {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedJoin) : {};
  } catch {
    return {};
  }
}

/**
 * Join form. Two ways in:
 *  - **Create a new room** — the room name is generated automatically; the
 *    host optionally enables E2EE (and shares the key) or transcription.
 *  - **Join by link** — pasting an invite link autofills server URL, room
 *    name and the E2EE/transcription settings; the user only enters a name.
 *
 * Previously entered settings (except the E2EE key) are remembered in
 * localStorage. The E2EE key never leaves the client, is never persisted and
 * never sent to the token server (HIGH RISK 4.2).
 */
export function JoinPage() {
  const navigate = useNavigate();
  const persisted = useMemo(() => loadPersisted(), []);

  const [serverUrl, setServerUrl] = useState(persisted.serverUrl ?? "");
  const [identity, setIdentity] = useState(persisted.identity ?? "");
  const [e2eeKey, setE2eeKey] = useState("");
  const [e2eeEnabled, setE2eeEnabled] = useState(persisted.e2eeEnabled ?? false);
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(
    persisted.transcriptionEnabled ?? false,
  );

  const [inviteInput, setInviteInput] = useState("");
  const [linkRoomName, setLinkRoomName] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const { copied: keyCopied, copy: copyKey } = useCopyFeedback();

  // Remember settings (never the E2EE key) for next launch.
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ serverUrl, identity, e2eeEnabled, transcriptionEnabled }),
      );
    } catch {
      // localStorage may be unavailable; persistence is best-effort.
    }
  }, [serverUrl, identity, e2eeEnabled, transcriptionEnabled]);

  function handleToggleE2ee(checked: boolean) {
    setE2eeEnabled(checked);
    if (checked) {
      setTranscriptionEnabled(false);
    } else {
      setE2eeKey("");
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
  }

  function handleInviteChange(value: string) {
    setInviteInput(value);

    if (!value.trim()) {
      setLinkRoomName(null);
      setInviteError(null);
      return;
    }

    const parsed = parseInviteLink(value);
    if (!parsed) {
      setInviteError("Не удалось распознать ссылку-приглашение");
      setLinkRoomName(null);
      return;
    }

    setInviteError(null);
    setServerUrl(parsed.serverUrl);
    setLinkRoomName(parsed.roomName);

    if (parsed.e2eeKey) {
      setE2eeEnabled(true);
      setE2eeKey(parsed.e2eeKey);
      setTranscriptionEnabled(false);
    } else {
      setE2eeEnabled(false);
      setE2eeKey("");
      setTranscriptionEnabled(parsed.transcriptionEnabled);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!identity.trim() || !serverUrl.trim()) {
      return;
    }

    // Join the room from the invite link, or create a fresh one.
    const roomName = linkRoomName ?? generateRoomName();

    const config: SessionConfig = {
      serverUrl: serverUrl.trim(),
      roomName,
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
          <span className="join-page__label">Присоединиться по ссылке</span>
          <input
            value={inviteInput}
            onChange={(e) => handleInviteChange(e.currentTarget.value)}
            placeholder="Вставьте ссылку-приглашение"
            autoComplete="off"
            spellCheck={false}
          />
          {inviteError && <span className="join-page__hint join-page__hint--error">{inviteError}</span>}
          {linkRoomName && (
            <span className="join-page__hint">Комната из ссылки: {linkRoomName}</span>
          )}
        </label>

        <div className="join-page__divider">
          <span>или создайте новую</span>
        </div>

        <label className="join-page__field">
          <span className="join-page__label">URL сервера</span>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.currentTarget.value)}
            placeholder="https://your-domain.com"
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
                onChange={(e) => setE2eeKey(e.currentTarget.value)}
                placeholder="Вставьте E2EE ключ"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="e2ee-key-field__buttons">
                <button type="button" onClick={handleGenerateKey}>
                  Сгенерировать секретный ключ
                </button>
                {e2eeKey && (
                  <button
                    type="button"
                    className={`icon-button copy-button${keyCopied ? " copy-button--copied" : ""}`}
                    onClick={() => void copyKey(e2eeKey)}
                    aria-label="Скопировать ключ"
                    title={keyCopied ? "Скопировано" : "Копировать"}
                  >
                    {keyCopied ? <Check size={18} /> : <Copy size={18} />}
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
          Подключиться
        </button>
      </form>
    </main>
  );
}
