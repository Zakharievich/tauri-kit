import { Track } from "livekit-client";
import { TrackToggle, DisconnectButton } from "@livekit/components-react";
import { Check, MessageSquare, UserPlus, X } from "lucide-react";
import { buildInviteLink } from "../../services/inviteLink";
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
      {/* Request system/tab audio alongside the screen video. Browser support
          is limited: works on Chromium (tab/window audio); on macOS system
          audio needs a virtual device (BlackHole/Loopback). If the platform
          can't provide audio, screen sharing still starts video-only. */}
      {/* `selfBrowserSurface: "exclude"` keeps the app's own window out of the
          getDisplayMedia picker so a user can't pick the TauriKit window as the
          source (which would recurse). RoomView also filters the local screen
          share out of the render, which is the primary recursion guard. */}
      <TrackToggle
        source={Track.Source.ScreenShare}
        captureOptions={{ audio: true, selfBrowserSurface: "exclude", systemAudio: "include" }}
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

      <DisconnectButton onClick={onLeave} className="control-bar__leave" aria-label="Выйти" title="Выйти">
        <X size={18} />
      </DisconnectButton>
    </div>
  );
}
