import {
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";

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
  );

  return (
    <div className="room-view">
      <GridLayout tracks={tracks}>
        <ParticipantTile />
      </GridLayout>
      <RoomAudioRenderer />
    </div>
  );
}
