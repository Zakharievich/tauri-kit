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

export type E2EESetup = {
  /** Pass to `keyProvider.setKey()` (async) before calling `room.setE2EEEnabled(true)`. */
  keyProvider: ExternalE2EEKeyProvider;
  /** Pass as `RoomOptions['e2ee']` when constructing the `Room`. */
  roomOptionsE2ee: NonNullable<RoomOptions["e2ee"]>;
};

/**
 * Builds the keyProvider + worker for E2EE (`RoomOptions['e2ee']`). Building
 * this is synchronous; setting the actual key is not (see
 * `ExternalE2EEKeyProvider.setKey()`, called separately by the caller once
 * the Room exists — see useLiveKitRoom.ts).
 *
 * The key itself never touches this function's return value directly — it
 * is only ever passed to `ExternalE2EEKeyProvider.setKey()` by the caller,
 * never logged and never transmitted to the token server (HIGH RISK 4.2).
 */
export function createE2EESetup(): E2EESetup {
  const keyProvider = new ExternalE2EEKeyProvider();

  return {
    keyProvider,
    roomOptionsE2ee: {
      keyProvider,
      worker: new Worker(new URL("livekit-client/e2ee-worker", import.meta.url)),
    },
  };
}
