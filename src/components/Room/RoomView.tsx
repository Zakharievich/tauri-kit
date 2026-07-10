import {
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  isTrackReference,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import type { RemoteAudioTrack } from "livekit-client";
import { ScreenShareView } from "../ScreenShare";

/** Must match `AGENT_IDENTITY` in agent/main.py — the optional STT agent
 * joins as a regular (audio-only, non-publishing) participant, so it must
 * be filtered out here or it shows up as an empty placeholder tile. */
const AGENT_IDENTITY = "agent-transcriber";

/**
 * Renders every participant's camera tracks in a responsive grid, screen
 * shares in a dedicated area above the grid (with fullscreen + per-share
 * mute controls), plus the hidden audio renderer required to actually play
 * remote audio.
 */
export function RoomView() {
  const notAgent = (identity: string) => identity !== AGENT_IDENTITY;

  const cameraTracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  ).filter((trackRef) => notAgent(trackRef.participant.identity));

  // Never render the local participant's own screen share back to themselves:
  // doing so puts a live <VideoTrack> of their screen inside the app window,
  // which — when the whole screen or the app window is the shared surface —
  // is re-captured recursively ("screen-in-screen-in-screen"). Remote screen
  // shares are still shown normally.
  const screenTracks = useTracks(
    [{ source: Track.Source.ScreenShare, withPlaceholder: false }],
    { onlySubscribed: false },
  )
    .filter((trackRef) => notAgent(trackRef.participant.identity))
    .filter((trackRef) => !trackRef.participant.isLocal)
    .filter(isTrackReference);

  const screenAudioTracks = useTracks(
    [{ source: Track.Source.ScreenShareAudio, withPlaceholder: false }],
    { onlySubscribed: false },
  ).filter((trackRef) => !trackRef.participant.isLocal);

  function findScreenAudio(identity: string): RemoteAudioTrack | null {
    const ref = screenAudioTracks.find((a) => a.participant.identity === identity);
    const track = ref?.publication?.track;
    return track && "setVolume" in track ? (track as RemoteAudioTrack) : null;
  }

  return (
    <div className="room-view">
      {screenTracks.length > 0 && (
        <div className="room-view__screenshares">
          {screenTracks.map((trackRef) => (
            <ScreenShareView
              key={trackRef.publication.trackSid}
              trackRef={trackRef}
              audioTrack={findScreenAudio(trackRef.participant.identity)}
            />
          ))}
        </div>
      )}

      <GridLayout tracks={cameraTracks}>
        <ParticipantTile />
      </GridLayout>
      <RoomAudioRenderer />
    </div>
  );
}
