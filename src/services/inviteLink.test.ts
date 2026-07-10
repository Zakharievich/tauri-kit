import { describe, it, expect } from "vitest";
import { buildInviteLink, parseInviteLink, generateRoomName } from "./inviteLink";

/** Builds a legacy `tk1:<base64url(json)>` token the way old builds did, so we
 *  can assert backward-compatible parsing without importing removed code. */
function legacyTk1(serverUrl: string, roomName: string, t: 0 | 1, key?: string): string {
  const arr: unknown[] = [serverUrl, roomName, t];
  if (key) arr.push(key);
  const b64 = btoa(JSON.stringify(arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `tk1:${b64}`;
}

describe("inviteLink", () => {
  it("round-trips a full config (with E2EE key)", () => {
    const link = buildInviteLink({
      serverUrl: "https://example.com:3001",
      roomName: "room-abc123",
      e2eeKey: "deadbeef",
      transcriptionEnabled: false,
    });

    const parsed = parseInviteLink(link);
    expect(parsed).toEqual({
      serverUrl: "https://example.com:3001",
      roomName: "room-abc123",
      e2eeKey: "deadbeef",
      transcriptionEnabled: false,
    });
  });

  it("round-trips a real 64-char hex E2EE key", () => {
    const e2eeKey = "0123456789abcdef".repeat(4); // 64 hex chars = 32 bytes
    const link = buildInviteLink({
      serverUrl: "https://conf.example.com",
      roomName: "room-0123456789abcdef",
      e2eeKey,
      transcriptionEnabled: true,
    });

    expect(parseInviteLink(link)).toEqual({
      serverUrl: "https://conf.example.com",
      roomName: "room-0123456789abcdef",
      e2eeKey,
      transcriptionEnabled: true,
    });
  });

  it("round-trips a config without a key but with transcription", () => {
    const link = buildInviteLink({
      serverUrl: "https://example.com",
      roomName: "my-room",
      transcriptionEnabled: true,
    });

    const parsed = parseInviteLink(link);
    expect(parsed).toEqual({
      serverUrl: "https://example.com",
      roomName: "my-room",
      e2eeKey: undefined,
      transcriptionEnabled: true,
    });
  });

  it("produces a real-looking `https://<host>/j#…` link, not a query-string URL", () => {
    const link = buildInviteLink({
      serverUrl: "https://example.com",
      roomName: "room-abc123",
      transcriptionEnabled: false,
    });
    expect(link.startsWith("https://example.com/j#")).toBe(true);
    expect(link).not.toContain("?");
  });

  it("is shorter than the legacy query-string form in the common (no-key) case", () => {
    const config = {
      serverUrl: "https://conference.example.com:7880",
      roomName: "room-0123456789abcdef",
      transcriptionEnabled: false,
    };
    const legacy =
      `https://tauri-kit.app/join?s=${encodeURIComponent(config.serverUrl)}` +
      `&r=${encodeURIComponent(config.roomName)}&t=0`;
    expect(buildInviteLink(config).length).toBeLessThan(legacy.length);
  });

  it("is markedly shorter than the legacy tk1 token when a key is present", () => {
    const config = {
      serverUrl: "https://conference.example.com",
      roomName: "room-0123456789abcdef",
      e2eeKey: "0123456789abcdef".repeat(4),
      transcriptionEnabled: false,
    };
    const tk1 = legacyTk1(config.serverUrl, config.roomName, 0, config.e2eeKey);
    expect(buildInviteLink(config).length).toBeLessThan(tk1.length);
  });

  it("preserves a unicode room name", () => {
    const link = buildInviteLink({
      serverUrl: "https://ex.com",
      roomName: "комната-1",
      transcriptionEnabled: false,
    });
    const parsed = parseInviteLink(link);
    expect(parsed?.serverUrl).toBe("https://ex.com");
    expect(parsed?.roomName).toBe("комната-1");
  });

  it("still parses legacy `tk1:` tokens (backward compatibility)", () => {
    const parsed = parseInviteLink(
      legacyTk1("https://old.example.com", "room-old", 1, "cafe"),
    );
    expect(parsed).toEqual({
      serverUrl: "https://old.example.com",
      roomName: "room-old",
      e2eeKey: "cafe",
      transcriptionEnabled: true,
    });
  });

  it("still parses legacy query-string links (backward compatibility)", () => {
    const parsed = parseInviteLink(
      "https://tauri-kit.app/join?s=https://example.com&r=room-legacy&t=1",
    );
    expect(parsed).toEqual({
      serverUrl: "https://example.com",
      roomName: "room-legacy",
      e2eeKey: undefined,
      transcriptionEnabled: true,
    });
  });

  it("returns null for non-link / garbage input", () => {
    expect(parseInviteLink("not a link")).toBeNull();
    expect(parseInviteLink("")).toBeNull();
    expect(parseInviteLink("   ")).toBeNull();
    expect(parseInviteLink("tk1:!!!not-base64!!!")).toBeNull();
    expect(parseInviteLink("https://example.com/j#!!!not-base64!!!")).toBeNull();
    expect(parseInviteLink("https://example.com/j")).toBeNull(); // no fragment
  });

  it("returns null when required params are missing", () => {
    expect(parseInviteLink("https://tauri-kit.app/join?s=https://x.com")).toBeNull();
    expect(parseInviteLink("https://tauri-kit.app/join?r=room-1")).toBeNull();
  });

  it("generates unique, URL-safe room names", () => {
    const a = generateRoomName();
    const b = generateRoomName();
    expect(a).toMatch(/^room-[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
    expect(encodeURIComponent(a)).toBe(a);
  });
});
