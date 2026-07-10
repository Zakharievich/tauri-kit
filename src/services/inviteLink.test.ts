import { describe, it, expect } from "vitest";
import { buildInviteLink, parseInviteLink, generateRoomName } from "./inviteLink";

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

  it("produces a compact `tk1:` link, not a query-string URL", () => {
    const link = buildInviteLink({
      serverUrl: "https://example.com",
      roomName: "room-abc123",
      transcriptionEnabled: false,
    });
    expect(link.startsWith("tk1:")).toBe(true);
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

  it("preserves values needing URL/unicode encoding", () => {
    const link = buildInviteLink({
      serverUrl: "https://ex.com/base path",
      roomName: "комната #1",
      transcriptionEnabled: false,
    });
    const parsed = parseInviteLink(link);
    expect(parsed?.serverUrl).toBe("https://ex.com/base path");
    expect(parsed?.roomName).toBe("комната #1");
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
