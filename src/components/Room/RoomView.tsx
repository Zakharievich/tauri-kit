import {
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";

/** Must match `AGENT_IDENTITY` in agent/main.py — the optional STT agent
 * joins as a regular (audio-only, non-publishing) participant, so it must
 * be filtered out here or it shows up as an empty placeholder tile. */
const AGENT_IDENTITY = "agent-transcriber";

/**
 * Renders every participant's camera/microphone tracks in a responsive grid,
 * plus the hidden audio renderer required to actually play remote audio.
 *
 * No business logic here — purely a composition of livekit-components
 * primitives, consistent with ControlBar.
 */
export function RoomView() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  ).filter((trackRef) => trackRef.participant.identity !== AGENT_IDENTITY);

  return (
    <div className="room-view">
      <GridLayout tracks={tracks}>
        <ParticipantTile />
      </GridLayout>
      <RoomAudioRenderer />
    </div>
  );
}
