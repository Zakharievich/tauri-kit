import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { generateE2EEKey } from "../services/e2eeService";
import { generateRoomName, parseInviteLink } from "../services/inviteLink";
import type { ParsedInvite } from "../services/inviteLink";
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
 * Landing screen with two clearly separated flows:
 *  - **Join by link** — paste an invite link and press "Join". The link's
 *    contents (server URL, room name, E2EE key, transcription flag) are parsed
 *    and kept internally; they are NEVER written into the visible form fields,
 *    so the user doesn't see the technical room name. The user only supplies
 *    their name. This flow never creates a room.
 *  - **Create a new room** ("Создать") — mints a fresh room name and uses the
 *    currently selected settings (server URL, E2EE, transcription). This flow
 *    is independent of the invite link.
 *
 * Previously entered settings (except the E2EE key) are remembered in
 * localStorage. The E2EE key never leaves the client, is never persisted and
 * never sent to the token server (HIGH RISK 4.2).
 *
 * The E2EE key is intentionally never shown or editable: ticking "Шифрование"
 * generates one silently, and pasting an invite that carries a key loads it
 * behind the scenes. The only way to share it is the in-room "add participant"
 * invite link (which embeds the key), so it can't be copied out on its own.
 */
export function JoinPage() {
  const navigate = useNavigate();
  const persisted = useMemo(() => loadPersisted(), []);

  const [serverUrl, setServerUrl] = useState(persisted.serverUrl ?? "");
  const [identity, setIdentity] = useState(persisted.identity ?? "");
  // Kept in state but never rendered. If E2EE was remembered as on, mint a key
  // up front so the invariant "e2eeEnabled ⇒ a key exists" holds on load too.
  const [e2eeKey, setE2eeKey] = useState(() =>
    persisted.e2eeEnabled ? generateE2EEKey() : "",
  );
  const [e2eeEnabled, setE2eeEnabled] = useState(persisted.e2eeEnabled ?? false);
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(
    persisted.transcriptionEnabled ?? false,
  );

  const [inviteInput, setInviteInput] = useState("");
  // Parsed invite kept hidden from the form; used only when the user presses
  // "Join". Never mirrored into the visible fields above.
  const [parsedInvite, setParsedInvite] = useState<ParsedInvite | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Remember settings (never the E2EE key) for next launch. Only the "create"
  // flow reads these back; the join flow ignores them. Debounced so we don't
  // write to localStorage on every keystroke in the text fields.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ serverUrl, identity, e2eeEnabled, transcriptionEnabled }),
        );
      } catch {
        // localStorage may be unavailable; persistence is best-effort.
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [serverUrl, identity, e2eeEnabled, transcriptionEnabled]);

  function handleToggleE2ee(checked: boolean) {
    setE2eeEnabled(checked);
    if (checked) {
      setTranscriptionEnabled(false);
      // Generate the key behind the scenes — it is never shown; it can only be
      // shared via the in-room "add participant" invite link.
      setE2eeKey(generateE2EEKey());
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

  function handleInviteChange(value: string) {
    setInviteInput(value);

    if (!value.trim()) {
      // Clearing a previously valid invite returns the form to a blank "create"
      // state (server URL and options) so the — now re-enabled — Создать button
      // starts fresh. The name is left intact (it isn't part of the link; each
      // participant supplies their own). Only reset when an invite was actually
      // loaded, so remembered settings survive a normal launch with an empty field.
      if (parsedInvite) {
        setServerUrl("");
        setE2eeEnabled(false);
        setE2eeKey("");
        setTranscriptionEnabled(false);
      }
      setParsedInvite(null);
      setInviteError(null);
      return;
    }

    const parsed = parseInviteLink(value);
    if (!parsed) {
      setInviteError("Не удалось распознать ссылку-приглашение");
      setParsedInvite(null);
      return;
    }

    setInviteError(null);
    setParsedInvite(parsed);

    // Reflect the invite's encryption state in the (key-less) options so the
    // user can see the session is encrypted — without ever exposing the key.
    const hasKey = !!parsed.e2eeKey;
    setE2eeEnabled(hasKey);
    setE2eeKey(parsed.e2eeKey ?? "");
    if (hasKey) {
      setTranscriptionEnabled(false);
    }
  }

  /** Join flow: use the parsed invite (hidden from the form) + the user's name.
   *  Never generates a room name, never creates a room. */
  function handleJoinFromLink() {
    if (!parsedInvite || !identity.trim()) return;

    const config: SessionConfig = {
      serverUrl: parsedInvite.serverUrl,
      roomName: parsedInvite.roomName,
      identity: identity.trim(),
      e2eeKey: parsedInvite.e2eeKey,
      transcriptionEnabled: parsedInvite.transcriptionEnabled,
    };

    navigate("/room", { state: config });
  }

  /** Create flow: always mints a fresh room name from the visible settings;
   *  independent of the invite link. */
  function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // In join mode the "Создать" button is hidden, but pressing Enter in a
    // field still submits the form — ignore it so a loaded invite never
    // accidentally creates a room.
    if (parsedInvite) {
      return;
    }

    if (!identity.trim() || !serverUrl.trim()) {
      return;
    }

    const config: SessionConfig = {
      serverUrl: serverUrl.trim(),
      roomName: generateRoomName(),
      identity: identity.trim(),
      e2eeKey: e2eeEnabled && e2eeKey.trim() ? e2eeKey.trim() : undefined,
      transcriptionEnabled,
    };

    navigate("/room", { state: config });
  }

  const canJoin = parsedInvite !== null && identity.trim().length > 0;
  // A valid invite switches the page to a compact "join" mode: the create-only
  // divider and button are hidden and the form is narrowed.
  const isJoinMode = parsedInvite !== null;

  return (
    <main className="join-page">
      <form
        className={`join-page__form${isJoinMode ? " join-page__form--compact" : ""}`}
        onSubmit={handleCreateRoom}
      >
        <label className="join-page__field">
          <span className="join-page__label">Ваше имя</span>
          <input
            value={identity}
            onChange={(e) => setIdentity(e.currentTarget.value)}
            placeholder="your-name"
            required
          />
        </label>

        <label className="join-page__field">
          <span className="join-page__label">Присоединиться к комнате по ссылке</span>
          <div className="join-page__invite-row">
            <input
              value={inviteInput}
              onChange={(e) => handleInviteChange(e.currentTarget.value)}
              placeholder="Вставьте ссылку-приглашение"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="join-page__join"
              onClick={handleJoinFromLink}
              disabled={!canJoin}
              title={
                parsedInvite
                  ? identity.trim()
                    ? "Присоединиться к комнате"
                    : "Введите своё имя"
                  : "Вставьте корректную ссылку-приглашение"
              }
            >
              Join
            </button>
          </div>
          {inviteError && <span className="join-page__hint join-page__hint--error">{inviteError}</span>}
        </label>

        {!isJoinMode && (
          <div className="join-page__divider">
            <span>или создайте новую</span>
          </div>
        )}

        <label className="join-page__field">
          <span className="join-page__label">URL сервера</span>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.currentTarget.value)}
            placeholder="https://your-domain.com"
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
            <span className="join-page__hint">
              Ключ шифрования создаётся автоматически и передаётся только через ссылку-приглашение
              (кнопка «Добавить участника» в комнате).
            </span>
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

        {!isJoinMode && (
          <button type="submit" className="join-page__submit">
            Создать
          </button>
        )}
      </form>
    </main>
  );
}
