import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRoomOptions,
  getScreenShareCaptureOptions,
  pickVideoCodec,
} from "./mediaOptions";

function setUserAgent(ua: string) {
  Object.defineProperty(globalThis.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

function mockEncodeCapabilities(mimeTypes: string[]) {
  vi.stubGlobal("RTCRtpSender", {
    getCapabilities: () => ({
      codecs: mimeTypes.map((mimeType) => ({ mimeType, clockRate: 90000 })),
    }),
  });
}

const CHROMIUM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const WEBKIT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickVideoCodec", () => {
  it("always uses vp8 for E2EE rooms even when better codecs are available", () => {
    mockEncodeCapabilities(["video/AV1", "video/VP9", "video/VP8"]);
    expect(pickVideoCodec({ e2eeKey: "deadbeef" })).toBe("vp8");
  });

  it("prefers AV1, then VP9, then VP8 based on encode support", () => {
    mockEncodeCapabilities(["video/AV1", "video/VP9", "video/VP8"]);
    expect(pickVideoCodec({ e2eeKey: undefined })).toBe("av1");

    mockEncodeCapabilities(["video/VP9", "video/VP8"]);
    expect(pickVideoCodec({ e2eeKey: undefined })).toBe("vp9");

    mockEncodeCapabilities(["video/VP8"]);
    expect(pickVideoCodec({ e2eeKey: undefined })).toBe("vp8");
  });

  it("falls back to vp8 when RTCRtpSender.getCapabilities is unavailable", () => {
    vi.stubGlobal("RTCRtpSender", undefined);
    expect(pickVideoCodec({ e2eeKey: undefined })).toBe("vp8");
  });
});

describe("buildRoomOptions", () => {
  it("enables native noise suppression and adaptive stream / dynacast", () => {
    const options = buildRoomOptions({ e2eeKey: undefined });
    expect(options.adaptiveStream).toBe(true);
    expect(options.dynacast).toBe(true);
    expect(options.audioCaptureDefaults?.noiseSuppression).toBe(true);
    expect(options.audioCaptureDefaults?.echoCancellation).toBe(true);
    expect(options.audioCaptureDefaults?.autoGainControl).toBe(true);
  });

  it("disables RED audio for E2EE rooms and enables it otherwise", () => {
    expect(buildRoomOptions({ e2eeKey: "deadbeef" }).publishDefaults?.red).toBe(false);
    expect(buildRoomOptions({ e2eeKey: undefined }).publishDefaults?.red).toBe(true);
  });

  it("uses manual simulcast layers for VP8 and a backup codec for SVC codecs", () => {
    // E2EE forces vp8 → manual simulcast layers, no backup codec.
    const vp8 = buildRoomOptions({ e2eeKey: "deadbeef" }).publishDefaults;
    expect(vp8?.videoCodec).toBe("vp8");
    expect(vp8?.videoSimulcastLayers?.length).toBeGreaterThan(0);
    expect(vp8?.backupCodec).toBeUndefined();

    // VP9 (SVC) → backup codec, no manual layers.
    mockEncodeCapabilities(["video/VP9", "video/VP8"]);
    const vp9 = buildRoomOptions({ e2eeKey: undefined }).publishDefaults;
    expect(vp9?.videoCodec).toBe("vp9");
    expect(vp9?.backupCodec).toBe(true);
    expect(vp9?.videoSimulcastLayers).toBeUndefined();
  });
});

describe("getScreenShareCaptureOptions", () => {
  it("passes only portable options on WebKit (macOS WKWebView)", () => {
    setUserAgent(WEBKIT_UA);
    expect(getScreenShareCaptureOptions()).toEqual({ audio: true });
  });

  it("includes Chromium-only hints on Chromium", () => {
    setUserAgent(CHROMIUM_UA);
    expect(getScreenShareCaptureOptions()).toEqual({
      audio: true,
      selfBrowserSurface: "exclude",
      systemAudio: "include",
    });
  });
});
