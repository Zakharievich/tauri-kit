import type { SessionConfig } from "../types";

/**
 * Current invite format: an ordinary-looking URL whose host IS the server and
 * whose fragment carries everything a participant needs to join:
 *
 *     https://conf.example.com/j#<base64url(binary payload)>
 *
 * Two properties make this both short and safe:
 *  - the host doubles as `serverUrl`, so it is not duplicated inside the
 *    payload (unlike the old `tk1:` token, which packed the full URL again);
 *  - the fragment (`#…`) is never sent to the server by any HTTP client, so
 *    the E2EE key it may contain does not leak to Caddy / the token-server.
 *
 * The binary payload (before base64url) is:
 *   byte 0        flags  — bit0 transcription, bit1 has-E2EE-key
 *   bytes 1..2    room name length (big-endian uint16)
 *   bytes 3..     room name (UTF-8)
 *   bytes ..end   E2EE key as raw bytes (present iff the has-key flag is set)
 *
 * The key is stored as raw bytes rather than its 64-char hex string, which is
 * what actually halves the link for encrypted rooms.
 *
 * NOTE: the E2EE key travels inside the link, so anyone with the link can
 * decrypt the session. This is a deliberate trade-off for one-click joins; the
 * link is shared out-of-band by the host. (Truly tiny links would require a
 * server-side store, which conflicts with the app's no-server-storage rule.)
 */

/** Path marker for the current invite URL format (`https://<host>/j#…`). */
const JOIN_PATH = "/j";

/** Prefix of the legacy compact format (`tk1:<base64url json>`), still parsed
 *  for backward compatibility so old links keep working. */
const LEGACY_SCHEME = "tk1:";

const FLAG_TRANSCRIPTION = 1 << 0;
const FLAG_HAS_KEY = 1 << 1;

/** Fields an invite link carries. `identity` is intentionally excluded —
 *  every participant enters their own name. */
export type ParsedInvite = {
  serverUrl: string;
  roomName: string;
  e2eeKey?: string;
  transcriptionEnabled: boolean;
};

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decodes an even-length hex string to raw bytes. Returns null for anything
 *  that isn't valid hex, so a malformed key can't corrupt the payload. */
function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Builds a compact, shareable invite link (see the module doc for the format).
 * Everything needed to join is encoded: server URL (as the link host), room
 * name, transcription flag and — if set — the E2EE key.
 */
export function buildInviteLink(
  config: Pick<SessionConfig, "serverUrl" | "roomName" | "e2eeKey" | "transcriptionEnabled">,
): string {
  const roomBytes = new TextEncoder().encode(config.roomName);

  let flags = 0;
  if (config.transcriptionEnabled) flags |= FLAG_TRANSCRIPTION;

  // The key is always hex (generateE2EEKey), but tolerate a non-hex value by
  // simply omitting it rather than emitting a corrupt payload.
  const keyBytes = config.e2eeKey ? hexToBytes(config.e2eeKey) : null;
  if (keyBytes) flags |= FLAG_HAS_KEY;

  const payload = new Uint8Array(3 + roomBytes.length + (keyBytes?.length ?? 0));
  payload[0] = flags;
  payload[1] = (roomBytes.length >> 8) & 0xff;
  payload[2] = roomBytes.length & 0xff;
  payload.set(roomBytes, 3);
  if (keyBytes) payload.set(keyBytes, 3 + roomBytes.length);

  const url = new URL(config.serverUrl);
  url.pathname = JOIN_PATH;
  url.search = "";
  url.hash = toBase64Url(payload);
  return url.toString();
}

/**
 * Parses an invite link. Accepts the current `https://<host>/j#…` format and,
 * for backward compatibility, the legacy `tk1:` token and the even older
 * query-string URL. Returns `null` for anything that isn't a usable link (bad
 * encoding, or missing the required server URL / room name) so callers can
 * show a friendly error instead of crashing.
 */
export function parseInviteLink(raw: string): ParsedInvite | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(LEGACY_SCHEME)) {
    return parseCompact(trimmed.slice(LEGACY_SCHEME.length));
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // Legacy query-string form is the only one carrying `s`/`r` params.
  if (url.searchParams.has("s") || url.searchParams.has("r")) {
    return parseLegacy(url);
  }
  // Current form carries its payload in the fragment.
  if (url.hash.length > 1) {
    return parseFragment(url);
  }
  return null;
}

function parseFragment(url: URL): ParsedInvite | null {
  try {
    const payload = fromBase64Url(url.hash.slice(1));
    if (payload.length < 3) return null;

    const flags = payload[0];
    const roomLen = (payload[1] << 8) | payload[2];
    const roomEnd = 3 + roomLen;
    if (roomEnd > payload.length) return null;

    const roomName = new TextDecoder().decode(payload.subarray(3, roomEnd)).trim();
    const serverUrl = url.origin;
    if (!serverUrl || !roomName) return null;

    let e2eeKey: string | undefined;
    if ((flags & FLAG_HAS_KEY) !== 0) {
      const keyBytes = payload.subarray(roomEnd);
      if (keyBytes.length === 0) return null;
      e2eeKey = bytesToHex(keyBytes);
    }

    const transcriptionEnabled = (flags & FLAG_TRANSCRIPTION) !== 0;
    return { serverUrl, roomName, e2eeKey, transcriptionEnabled };
  } catch {
    return null;
  }
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

function parseLegacy(url: URL): ParsedInvite | null {
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
