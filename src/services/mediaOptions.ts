import { VideoPresets } from "livekit-client";
import type {
  RoomConnectOptions,
  RoomOptions,
  ScreenShareCaptureOptions,
  TrackPublishDefaults,
  VideoCodec,
} from "livekit-client";
import type { SessionConfig } from "../types";

/**
 * Central source of truth for every media setting the app applies to a
 * LiveKit `Room`. Kept as a pure, side-effect-free module so it can be unit
 * tested and so capture/publish/connect defaults live in one place instead of
 * being scattered across components.
 *
 * The whole app previously ran on bare LiveKit defaults (`new Room()` with no
 * `RoomOptions`): no noise suppression, no publish/codec tuning, no adaptive
 * stream. Everything here is the explicit, tuned replacement.
 */

/**
 * Whether the local client can *encode* `codec` for WebRTC. Uses
 * `RTCRtpSender.getCapabilities`, guarding environments where it's missing
 * (older webviews, jsdom under vitest) — there we conservatively report
 * "unsupported" so the caller falls back to the universally-supported VP8.
 */
function canEncodeVideo(codec: "av1" | "vp9" | "vp8"): boolean {
  const getCapabilities =
    typeof RTCRtpSender !== "undefined" && typeof RTCRtpSender.getCapabilities === "function"
      ? RTCRtpSender.getCapabilities.bind(RTCRtpSender)
      : null;
  if (!getCapabilities) return false;

  const capabilities = getCapabilities("video");
  if (!capabilities) return false;

  const mimeType = `video/${codec}`;
  return capabilities.codecs.some((c) => c.mimeType.toLowerCase() === mimeType);
}

/**
 * Picks the best video codec the current client can actually encode, in the
 * order AV1 → VP9 → VP8 (each participant publishes the best its own system
 * supports). Encrypted (E2EE) rooms always use VP8: it is the most
 * battle-tested codec with insertable-stream E2EE, and advanced/SVC codecs
 * are less reliable there.
 *
 * Note on the viewer side: LiveKit's backup codec (used when a subscriber
 * can't decode the primary) is limited to VP8/H264, so an incompatible viewer
 * always receives VP8 — there is no intermediate VP9 step for the viewer.
 */
export function pickVideoCodec(config: Pick<SessionConfig, "e2eeKey">): VideoCodec {
  if (config.e2eeKey) return "vp8";
  if (canEncodeVideo("av1")) return "av1";
  if (canEncodeVideo("vp9")) return "vp9";
  return "vp8";
}

/**
 * Builds the `RoomOptions` for a session. Branches on `config.e2eeKey` because
 * some options (audio RED, advanced codecs) are incompatible with E2EE.
 */
export function buildRoomOptions(config: Pick<SessionConfig, "e2eeKey">): RoomOptions {
  const videoCodec = pickVideoCodec(config);
  // AV1/VP9 are SVC codecs: LiveKit auto-enables built-in scalability
  // (L3T3_KEY) and disables manual simulcast layers for them.
  const isSvcCodec = videoCodec === "av1" || videoCodec === "vp9";

  const publishDefaults: TrackPublishDefaults = {
    videoCodec,
    videoEncoding: VideoPresets.h720.encoding,
    simulcast: true,
    dtx: true,
    // RED (redundant audio) is incompatible with E2EE; livekit-client forces
    // it off in that case — we set it explicitly for clarity.
    red: !config.e2eeKey,
  };

  if (isSvcCodec) {
    // Publish a VP8 backup track so subscribers that can't decode the SVC
    // primary still receive video.
    publishDefaults.backupCodec = true;
  } else {
    // Manual simulcast layers only apply to VP8.
    publishDefaults.videoSimulcastLayers = [VideoPresets.h180, VideoPresets.h360];
  }

  return {
    // Subscribe at a quality that matches each tile's on-screen size — saves
    // bandwidth and is far more stable on weak connections.
    adaptiveStream: true,
    // Let the SFU pause layers nobody is watching.
    dynacast: true,
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      // Stronger native noise suppression where the browser implements it;
      // overrides `noiseSuppression` when supported, ignored otherwise.
      voiceIsolation: true,
    },
    videoCaptureDefaults: {
      resolution: VideoPresets.h720.resolution,
    },
    publishDefaults,
  };
}

/** Connect options for `<LiveKitRoom connectOptions={...}>`. Auto-subscribe is
 *  the previous behaviour; livekit-client's built-in retry handles reconnects. */
export const roomConnectOptions: RoomConnectOptions = {
  autoSubscribe: true,
};

/**
 * Non-Chromium engine detection (macOS WKWebView / Safari). Their
 * `getDisplayMedia` does not understand Chromium-only constraints and can
 * mis-capture when they are passed.
 */
function isWebKitEngine(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
}

/**
 * Screen-share capture options. On Chromium we pass the hints that keep the
 * app's own window out of the picker and offer system audio. On WebKit those
 * options are unsupported and break capture (duplicated/garbled shares on
 * macOS), so we pass only the portable `{ audio: true }`. We also avoid
 * setting `resolution` on WebKit — Safari 17 caps capture to a low resolution
 * if any resolution is specified (webkit bug 263015).
 */
export function getScreenShareCaptureOptions(): ScreenShareCaptureOptions {
  if (isWebKitEngine()) {
    return { audio: true };
  }
  return { audio: true, selfBrowserSurface: "exclude", systemAudio: "include" };
}
