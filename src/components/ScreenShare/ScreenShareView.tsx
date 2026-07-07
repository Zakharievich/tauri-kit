import { ParticipantTile, TrackToggle, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";

/**
 * Standalone screen-share widget: a toggle button plus a tile that renders
 * the active screen-share track (local or remote), if any. Kept separate
 * from RoomView so it can be composed independently (e.g. shown/hidden or
 * placed in a dedicated layout region).
 */
export function ScreenShareView() {
  const screenShareTracks = useTracks(
    [{ source: Track.Source.ScreenShare, withPlaceholder: false }],
    {
      onlySubscribed: false,
    },
  );

  return (
    <div className="screen-share-view">
      <TrackToggle source={Track.Source.ScreenShare} captureOptions={{ audio: true }}>
        Share screen
      </TrackToggle>

      {screenShareTracks.length > 0 && (
        <div className="screen-share-view__tracks">
          {screenShareTracks.map((trackRef) => (
            <ParticipantTile
              key={trackRef.publication?.trackSid ?? trackRef.participant.identity}
              trackRef={trackRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}
