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

  it("preserves values needing URL encoding", () => {
    const link = buildInviteLink({
      serverUrl: "https://ex.com/base path",
      roomName: "комната #1",
      transcriptionEnabled: false,
    });
    const parsed = parseInviteLink(link);
    expect(parsed?.serverUrl).toBe("https://ex.com/base path");
    expect(parsed?.roomName).toBe("комната #1");
  });

  it("returns null for non-URL / garbage input", () => {
    expect(parseInviteLink("not a link")).toBeNull();
    expect(parseInviteLink("")).toBeNull();
    expect(parseInviteLink("   ")).toBeNull();
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
