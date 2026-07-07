import { Track } from "livekit-client";
import { TrackToggle, DisconnectButton } from "@livekit/components-react";

export type ControlBarProps = {
  onLeave?: () => void;
  onToggleChat?: () => void;
};

/**
 * Bottom control bar: mute mic, toggle camera, screen share, chat, leave.
 * No business logic here — only livekit-components primitives wired
 * to our styling. All state comes from the LiveKit room context.
 */
export function ControlBar({ onLeave, onToggleChat }: ControlBarProps) {
  return (
    <div className="control-bar">
      <TrackToggle source={Track.Source.Microphone} />
      <TrackToggle source={Track.Source.Camera} />
      <TrackToggle source={Track.Source.ScreenShare} />
      {onToggleChat && (
        <button type="button" onClick={onToggleChat}>
          Chat
        </button>
      )}
      <DisconnectButton onClick={onLeave}>Leave</DisconnectButton>
    </div>
  );
}
