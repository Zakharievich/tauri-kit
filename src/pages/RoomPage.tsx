import { useState } from "react";
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
  onLeave: (transcriptText: string | null) => void;
};

/**
 * Rendered inside <LiveKitRoom>, so hooks relying on the LiveKit room
 * context (useTranscription) can be used here.
 */
function RoomContent({ config, onLeave }: RoomContentProps) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const { text } = useTranscription(config.transcriptionEnabled);

  return (
    <>
      <div className="room-page__main">
        <RoomView />
        <ControlBar onLeave={() => onLeave(text)} onToggleChat={() => setIsChatOpen((open) => !open)} />
      </div>
      {isChatOpen && <ChatPanel onClose={() => setIsChatOpen(false)} />}
    </>
  );
}

/**
 * Wraps call UI in <LiveKitRoom> using token/options prepared by
 * useLiveKitRoom. Expects SessionConfig passed via router state from
 * JoinPage. Redirects back to "/" if no config is present.
 *
 * On leave, navigates to TranscriptPage carrying whatever transcript text
 * useTranscription accumulated (or null if the agent was absent/disabled —
 * graceful degradation, HIGH RISK 4.3).
 */
export function RoomPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const config = (location.state as SessionConfig | null) ?? null;

  const { token, serverUrl, roomOptions, isLoading, error } = useLiveKitRoom(config);

  function handleLeave(transcriptText: string | null) {
    navigate("/transcript", { state: { text: transcriptText } });
  }

  if (!config) {
    return (
      <main className="room-page">
        <p>No session config found.</p>
        <button onClick={() => navigate("/")}>Back to join page</button>
      </main>
    );
  }

  if (isLoading || !token || !serverUrl) {
    return (
      <main className="room-page">
        <p>{error ? `Error: ${error}` : "Connecting…"}</p>
      </main>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      options={roomOptions}
      connect
      onDisconnected={() => handleLeave(null)}
      data-lk-theme="default"
      style={{ height: "100vh", display: "flex" }}
    >
      <RoomContent config={config} onLeave={handleLeave} />
    </LiveKitRoom>
  );
}
