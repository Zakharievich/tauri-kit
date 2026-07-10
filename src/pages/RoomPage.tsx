import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { useLiveKitRoom } from "../hooks/useLiveKitRoom";
import { useTranscription } from "../hooks/useTranscription";
import { ControlBar } from "../components/Controls";
import { RoomView } from "../components/Room";
import { ChatPanel } from "../components/Chat";
import type { SessionConfig } from "../types";

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

  const handleLeave = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;

    if (config?.transcriptionEnabled) {
      navigate("/transcript", { state: { text: transcriptRef.current } });
    } else {
      navigate("/");
    }
  }, [config, navigate]);

  if (!config) {
    return (
      <main className="room-page room-page__status">
        <p>Конфигурация сессии не найдена.</p>
        <button onClick={() => navigate("/")}>Вернуться на главный экран</button>
      </main>
    );
  }

  if (error) {
    return (
      <main className="room-page room-page__status">
        <p className="room-page__error">Ошибка: {error}</p>
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
      onDisconnected={handleLeave}
      data-lk-theme="default"
      style={{ height: "100vh", display: "flex" }}
    >
      <RoomContent config={config} transcriptRef={transcriptRef} onLeave={handleLeave} />
    </LiveKitRoom>
  );
}
