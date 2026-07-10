import { Track } from "livekit-client";
import { TrackToggle, DisconnectButton } from "@livekit/components-react";
import { Check, MessageSquare, UserPlus, X } from "lucide-react";
import { buildInviteLink } from "../../services/inviteLink";
import { getScreenShareCaptureOptions } from "../../services/mediaOptions";
import { useCopyFeedback } from "../../hooks/useCopyFeedback";
import type { SessionConfig } from "../../types";

export type ControlBarProps = {
  /** Current session config — used to build an invite link for new participants. */
  config?: SessionConfig;
  onLeave?: () => void;
  onToggleChat?: () => void;
};

/**
 * Bottom control bar: mute mic, toggle camera, screen share (with audio),
 * chat, invite, leave. Media controls are livekit-components primitives;
 * "invite" builds a shareable link from the session config and copies it.
 */
export function ControlBar({ config, onLeave, onToggleChat }: ControlBarProps) {
  const { copied: inviteCopied, copy: copyInvite } = useCopyFeedback();

  function handleInvite() {
    if (!config) return;
    void copyInvite(buildInviteLink(config));
  }

  return (
    <div className="control-bar">
      <TrackToggle source={Track.Source.Microphone} />
      <TrackToggle source={Track.Source.Camera} />
      {/* Capture options are engine-specific (see getScreenShareCaptureOptions):
          Chromium gets `selfBrowserSurface: "exclude"` (keeps the app window
          out of the picker) + `systemAudio: "include"`; WebKit/WKWebView (macOS)
          gets only `{ audio: true }` because those Chromium-only hints break
          capture there. RoomView also filters the local screen share out of the
          render, which is the primary recursion guard. */}
      <TrackToggle
        source={Track.Source.ScreenShare}
        captureOptions={getScreenShareCaptureOptions()}
        title="Демонстрация экрана со звуком. На macOS для системного звука нужен виртуальный аудиодрайвер (BlackHole/Loopback)."
      />

      {onToggleChat && (
        <button type="button" className="icon-button" onClick={onToggleChat} aria-label="Чат" title="Чат">
          <MessageSquare size={18} />
        </button>
      )}

      {config && (
        <button
          type="button"
          className={`icon-button${inviteCopied ? " copy-button--copied" : ""}`}
          onClick={handleInvite}
          aria-label="Добавить участника"
          title={inviteCopied ? "Ссылка скопирована" : "Скопировать ссылку-приглашение"}
        >
          {inviteCopied ? <Check size={18} /> : <UserPlus size={18} />}
        </button>
      )}

      {/* Wrap so the click event isn't forwarded as an argument to onLeave
          (which is also used as LiveKit's onDisconnected(reason) handler). */}
      <DisconnectButton
        onClick={() => onLeave?.()}
        className="control-bar__leave"
        aria-label="Выйти"
        title="Выйти"
      >
        <X size={18} />
      </DisconnectButton>
    </div>
  );
}
