import { useLocation, useNavigate } from "react-router-dom";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import { useLiveKitRoom } from "../hooks/useLiveKitRoom";
import { ControlBar } from "../components/Controls";
import type { SessionConfig } from "../types";

/**
 * Wraps call UI in <LiveKitRoom> using token/options prepared by
 * useLiveKitRoom. Expects SessionConfig passed via router state from
 * JoinPage. Redirects back to "/" if no config is present.
 */
export function RoomPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const config = (location.state as SessionConfig | null) ?? null;

  const { token, serverUrl, roomOptions, isLoading, error } = useLiveKitRoom(config);

  function handleLeave() {
    navigate("/");
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
      onDisconnected={handleLeave}
      data-lk-theme="default"
      style={{ height: "100vh" }}
    >
      <VideoConference />
      <ControlBar onLeave={handleLeave} />
    </LiveKitRoom>
  );
}
