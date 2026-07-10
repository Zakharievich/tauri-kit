import type { SessionConfig } from "../types";

/** Prefix + version tag for the compact self-contained invite format
 *  (`tk1:<base64url payload>`). Bumping the number lets the parser tell
 *  encodings apart if the payload shape ever changes. */
const SCHEME = "tk1:";

/** Fields an invite link carries. `identity` is intentionally excluded —
 *  every participant enters their own name. */
export type ParsedInvite = {
  serverUrl: string;
  roomName: string;
  e2eeKey?: string;
  transcriptionEnabled: boolean;
};

/** Positional payload packed into the compact link (no field names, to keep
 *  it short): [serverUrl, roomName, transcription(0|1), e2eeKey?]. */
type InvitePayload = [string, string, 0 | 1, string?];

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Builds a compact, shareable invite link that encodes everything a
 * participant needs to join the same room: server URL, room name,
 * transcription flag and — if set — the E2EE key. The payload is a positional
 * JSON array, UTF-8 encoded and base64url-wrapped behind the `tk1:` scheme, so
 * the link is markedly shorter than a query-string URL (no base host, no
 * parameter names).
 *
 * NOTE: the E2EE key travels inside the link, so anyone with the link can
 * decrypt the session. This is a deliberate trade-off for one-click joins;
 * the link is shared out-of-band by the host. (Truly tiny links would require
 * a server-side store, which conflicts with the app's no-server-storage rule.)
 */
export function buildInviteLink(
  config: Pick<SessionConfig, "serverUrl" | "roomName" | "e2eeKey" | "transcriptionEnabled">,
): string {
  const payload: InvitePayload = [
    config.serverUrl,
    config.roomName,
    config.transcriptionEnabled ? 1 : 0,
  ];
  if (config.e2eeKey) {
    payload[3] = config.e2eeKey;
  }
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return SCHEME + toBase64Url(bytes);
}

/**
 * Parses an invite link. Accepts the current compact `tk1:` format and, for
 * backward compatibility, the legacy query-string URL produced by older
 * builds. Returns `null` for anything that isn't a usable link (bad encoding,
 * or missing the required server URL / room name) so callers can show a
 * friendly error instead of crashing.
 */
export function parseInviteLink(raw: string): ParsedInvite | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(SCHEME)) {
    return parseCompact(trimmed.slice(SCHEME.length));
  }
  return parseLegacy(trimmed);
}

function parseCompact(encoded: string): ParsedInvite | null {
  try {
    const json = new TextDecoder().decode(fromBase64Url(encoded));
    const payload = JSON.parse(json) as unknown;
    if (!Array.isArray(payload)) return null;

    const serverUrl = typeof payload[0] === "string" ? payload[0].trim() : "";
    const roomName = typeof payload[1] === "string" ? payload[1].trim() : "";
    if (!serverUrl || !roomName) return null;

    const transcriptionEnabled = payload[2] === 1;
    const e2eeKey = typeof payload[3] === "string" && payload[3].trim() ? payload[3].trim() : undefined;

    return { serverUrl, roomName, e2eeKey, transcriptionEnabled };
  } catch {
    return null;
  }
}

function parseLegacy(trimmed: string): ParsedInvite | null {
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
