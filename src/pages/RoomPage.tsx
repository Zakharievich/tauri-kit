import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ConnectionStateToast, LiveKitRoom, StartAudio } from "@livekit/components-react";
import "@livekit/components-styles";
import { DisconnectReason } from "livekit-client";
import { useLiveKitRoom } from "../hooks/useLiveKitRoom";
import { useTranscription } from "../hooks/useTranscription";
import { roomConnectOptions } from "../services/mediaOptions";
import { ControlBar } from "../components/Controls";
import { RoomView } from "../components/Room";
import { ChatPanel } from "../components/Chat";
import type { SessionConfig } from "../types";

/** Human-readable message for an abnormal LiveKit disconnect. Returns null for
 *  a normal, user-initiated leave (handled as a plain navigation). */
function describeDisconnect(reason?: DisconnectReason): string | null {
  switch (reason) {
    case undefined:
    case DisconnectReason.CLIENT_INITIATED:
      return null;
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "Вы подключились под тем же именем с другого устройства.";
    case DisconnectReason.SERVER_SHUTDOWN:
      return "Сервер конференций остановлен.";
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "Вас удалили из комнаты.";
    case DisconnectReason.ROOM_DELETED:
      return "Комната была закрыта.";
    case DisconnectReason.STATE_MISMATCH:
      return "Сессия рассинхронизировалась с сервером. Подключитесь заново.";
    case DisconnectReason.JOIN_FAILURE:
      return "Не удалось подключиться к комнате.";
    default:
      return "Соединение с комнатой прервано.";
  }
}

type RoomContentProps = {
  config: SessionConfig;
  transcriptRef: MutableRefObject<string | null>;
  onLeave: () => void;
};

/**
 * Rendered inside <LiveKitRoom>, so hooks relying on the LiveKit room
 * context (useTranscription) can be used here. The accumulated transcript is
 * mirrored into `transcriptRef` so the leave handler (which may run from
 * `onDisconnected`) always sees the latest text.
 */
function RoomContent({ config, transcriptRef, onLeave }: RoomContentProps) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const { text } = useTranscription(config.transcriptionEnabled);

  useEffect(() => {
    transcriptRef.current = text;
  }, [text, transcriptRef]);

  return (
    <>
      <div className="room-page__main">
        <RoomView />
        <ControlBar
          config={config}
          onLeave={onLeave}
          onToggleChat={() => setIsChatOpen((open) => !open)}
        />
      </div>
      {/* Kept mounted while closed so chat history and incoming messages/files
          are preserved; visibility is toggled via CSS. */}
      <ChatPanel isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
      {/* Reconnecting / reconnected toast. */}
      <ConnectionStateToast />
      {/* macOS/WKWebView blocks audio autoplay until a user gesture — this
          button is only visible when playback is blocked and starts it on
          click, then hides itself. On Chromium it never appears. */}
      <div className="room-page__start-audio">
        <StartAudio label="Нажмите, чтобы включить звук" />
      </div>
    </>
  );
}

/**
 * Wraps call UI in <LiveKitRoom> using token/options prepared by
 * useLiveKitRoom. Expects SessionConfig passed via router state from
 * JoinPage. Redirects back to "/" if no config is present.
 *
 * On leave: if transcription was enabled, go to TranscriptPage carrying the
 * accumulated text; otherwise return straight to the home screen (no extra
 * screen). A single idempotent handler is wired to both the Leave button and
 * `onDisconnected` so the two never double-navigate.
 */
export function RoomPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const config = (location.state as SessionConfig | null) ?? null;

  const { token, serverUrl, room, isLoading, error } = useLiveKitRoom(config);

  const leftRef = useRef(false);
  const transcriptRef = useRef<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Surface a fatal connection problem instead of silently navigating away.
  // Marks the session as "left" so a following onDisconnected doesn't also fire.
  const failWith = useCallback((message: string) => {
    if (leftRef.current) return;
    leftRef.current = true;
    setConnectionError(message);
  }, []);

  const handleLeave = useCallback(
    (reason?: DisconnectReason) => {
      if (leftRef.current) return;

      // Abnormal disconnects (server down, join failure, removed, …) show an
      // error; a normal user-initiated leave navigates as before.
      const message = describeDisconnect(reason);
      if (message) {
        failWith(message);
        return;
      }

      leftRef.current = true;
      if (config?.transcriptionEnabled) {
        navigate("/transcript", { state: { text: transcriptRef.current } });
      } else {
        navigate("/");
      }
    },
    [config, navigate, failWith],
  );

  // Fires when the initial connect() rejects (bad wsUrl, network, server down)
  // even though the token was obtained — previously this failure was invisible.
  const handleError = useCallback(
    (err: Error) => {
      failWith(err.message || "Не удалось подключиться к комнате.");
    },
    [failWith],
  );

  const displayError = error ?? connectionError;

  if (!config) {
    return (
      <main className="room-page room-page__status">
        <p>Конфигурация сессии не найдена.</p>
        <button onClick={() => navigate("/")}>Вернуться на главный экран</button>
      </main>
    );
  }

  if (displayError) {
    return (
      <main className="room-page room-page__status">
        <p className="room-page__error">Ошибка: {displayError}</p>
        <button onClick={() => navigate("/")}>Вернуться на главный экран</button>
      </main>
    );
  }

  if (isLoading || !token || !serverUrl) {
    return (
      <main className="room-page room-page__status">
        <p>Подключение…</p>
      </main>
    );
  }

  return (
    <LiveKitRoom
      room={room}
      serverUrl={serverUrl}
      token={token}
      connect
      connectOptions={roomConnectOptions}
      onDisconnected={handleLeave}
      onError={handleError}
      data-lk-theme="default"
      style={{ height: "100vh", display: "flex" }}
    >
      <RoomContent config={config} transcriptRef={transcriptRef} onLeave={handleLeave} />
    </LiveKitRoom>
  );
}
