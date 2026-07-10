import type { SessionConfig } from "../types";

/** Neutral carrier base — the link is pasted into the app, not opened by a
 *  browser, so the host is irrelevant; only the query params matter. */
const INVITE_BASE = "https://tauri-kit.app/join";

/** Fields an invite link carries. `identity` is intentionally excluded —
 *  every participant enters their own name. */
export type ParsedInvite = {
  serverUrl: string;
  roomName: string;
  e2eeKey?: string;
  transcriptionEnabled: boolean;
};

/**
 * Builds a shareable invite link that encodes everything a participant needs
 * to join the same room: server URL, room name, transcription flag and — if
 * set — the E2EE key.
 *
 * NOTE: the E2EE key travels inside the link, so anyone with the link can
 * decrypt the session. This is a deliberate trade-off for one-click joins;
 * the link is shared out-of-band by the host.
 */
export function buildInviteLink(
  config: Pick<SessionConfig, "serverUrl" | "roomName" | "e2eeKey" | "transcriptionEnabled">,
): string {
  const url = new URL(INVITE_BASE);
  url.searchParams.set("s", config.serverUrl);
  url.searchParams.set("r", config.roomName);
  url.searchParams.set("t", config.transcriptionEnabled ? "1" : "0");
  if (config.e2eeKey) {
    url.searchParams.set("e", "1");
    url.searchParams.set("k", config.e2eeKey);
  }
  return url.toString();
}

/**
 * Parses an invite link produced by {@link buildInviteLink}. Returns `null`
 * for anything that isn't a usable link (not a URL, or missing the required
 * server URL / room name) so callers can show a friendly error instead of
 * crashing.
 */
export function parseInviteLink(raw: string): ParsedInvite | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const serverUrl = url.searchParams.get("s")?.trim();
  const roomName = url.searchParams.get("r")?.trim();
  if (!serverUrl || !roomName) {
    return null;
  }

  const e2eeKey = url.searchParams.get("k")?.trim() || undefined;
  const transcriptionEnabled = url.searchParams.get("t") === "1";

  return { serverUrl, roomName, e2eeKey, transcriptionEnabled };
}

/** Generates a random, URL-safe room name for a freshly created room. */
export function generateRoomName(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `room-${suffix}`;
}
