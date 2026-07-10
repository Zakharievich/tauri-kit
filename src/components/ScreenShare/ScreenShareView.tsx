import { useRef, useState } from "react";
import { VideoTrack } from "@livekit/components-react";
import type { TrackReference } from "@livekit/components-react";
import { Maximize2, Volume2, VolumeX } from "lucide-react";

export type ScreenShareViewProps = {
  trackRef: TrackReference;
  /** Matching screen-share audio track, if the sender shared system/tab audio. */
  audioTrack?: { setVolume: (volume: number) => void } | null;
};

/**
 * Renders a single screen-share video tile with two viewer-side controls:
 *  - click the video (or the maximize button) to toggle native fullscreen,
 *  - a mute button that silences *this* screen share's audio locally
 *    (via the remote audio track's volume) without touching other
 *    participants' audio.
 */
export function ScreenShareView({ trackRef, audioTrack }: ScreenShareViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(false);

  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (el.requestFullscreen) {
      void el.requestFullscreen();
    }
  }

  function toggleMute() {
    setMuted((prev) => {
      const next = !prev;
      audioTrack?.setVolume(next ? 0 : 1);
      return next;
    });
  }

  return (
    <div
      className="screen-share-view"
      ref={containerRef}
      onClick={toggleFullscreen}
      title="Нажмите, чтобы развернуть на весь экран"
    >
      <VideoTrack trackRef={trackRef} />
      <div className="screen-share-view__controls" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="icon-button"
          onClick={toggleFullscreen}
          aria-label="Fullscreen"
          title="На весь экран"
        >
          <Maximize2 size={18} />
        </button>
        {audioTrack && (
          <button
            type="button"
            className="icon-button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            title={muted ? "Включить звук трансляции" : "Выключить звук трансляции"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        )}
      </div>
    </div>
  );
}
