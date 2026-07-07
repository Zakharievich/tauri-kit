import { ExternalE2EEKeyProvider } from "livekit-client";
import type { RoomOptions } from "livekit-client";

/** 32 random bytes → 256-bit key, encoded as a 64-char hex string. */
const E2EE_KEY_BYTE_LENGTH = 32;

/**
 * Generates a random E2EE key for a new room using the Web Crypto API
 * (`crypto.getRandomValues`). The host is expected to display this value in
 * the UI so it can be copied and shared with participants out-of-band.
 *
 * HIGH RISK 4.2: the key never leaves the client, is never logged and is
 * never sent to the token server or any other backend.
 */
export function generateE2EEKey(): string {
  const bytes = new Uint8Array(E2EE_KEY_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Builds the `RoomOptions['e2ee']` block from a raw key string.
 * Returns `undefined` when no key is provided (E2EE disabled).
 *
 * The key is only ever passed to `ExternalE2EEKeyProvider.setKey()` — it is
 * never logged and never transmitted to the token server (HIGH RISK 4.2).
 */
export function createE2EEOptions(key: string | undefined): RoomOptions["e2ee"] | undefined {
  if (!key) {
    return undefined;
  }

  const keyProvider = new ExternalE2EEKeyProvider();
  void keyProvider.setKey(key);

  return {
    keyProvider,
    worker: new Worker(new URL("livekit-client/e2ee-worker", import.meta.url)),
  };
}
