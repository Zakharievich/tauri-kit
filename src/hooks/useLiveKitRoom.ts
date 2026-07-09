import { useEffect, useMemo, useState } from "react";
import { Room } from "livekit-client";
import { requestToken, TokenServiceError } from "../services/tokenService";
import { createE2EESetup } from "../services/e2eeService";
import type { SessionConfig } from "../types";

export type UseLiveKitRoomState = {
  token: string | null;
  serverUrl: string | null;
  /** Pass as `<LiveKitRoom room={room}>` — E2EE (if any) is already enabled on it. */
  room: Room;
  isLoading: boolean;
  error: string | null;
};

/**
 * Prepares everything <LiveKitRoom> needs before it can mount:
 * - a fresh one-time token (via tokenService)
 * - a single `Room` instance for the session, with E2EE already fully
 *   activated on it if requested
 *
 * The `Room` (and its E2EE worker, if any) is created exactly once per
 * hook lifetime — i.e. once per RoomPage session, not on every render —
 * since `config` doesn't change while a session is mounted.
 *
 * The E2EE key never leaves the client, is never logged and never sent
 * to the token server (HIGH RISK 4.2).
 */
export function useLiveKitRoom(config: SessionConfig | null): UseLiveKitRoomState {
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { room, keyProvider } = useMemo(() => {
    if (!config?.e2eeKey) {
      return { room: new Room(), keyProvider: null };
    }
    const { keyProvider, roomOptionsE2ee } = createE2EESetup();
    return { room: new Room({ e2ee: roomOptionsE2ee }), keyProvider };
    // config is fixed for the lifetime of a session (see doc comment above) — intentionally empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Terminate the E2EE worker (if any) when the session ends — the previous
  // implementation recreated a Worker on every render and never cleaned one
  // up.
  useEffect(() => {
    return () => {
      const e2ee = room.options.e2ee;
      if (e2ee && "worker" in e2ee) {
        e2ee.worker.terminate();
      }
    };
  }, [room]);

  useEffect(() => {
    if (!config?.e2eeKey || !keyProvider) {
      return;
    }

    let cancelled = false;

    // Per LiveKit's E2EE guide, keyProvider.setKey() must resolve before
    // room.setE2EEEnabled(true) — <LiveKitRoom> does not do either of these
    // automatically just because `e2ee` was set on the Room's options, so
    // both must happen explicitly here, before the room is handed off to
    // <LiveKitRoom room={room} connect> (which only mounts once token/
    // serverUrl are ready, i.e. after this has had time to complete).
    keyProvider
      .setKey(config.e2eeKey)
      .then(() => {
        if (cancelled) return;
        return room.setE2EEEnabled(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("Failed to enable E2EE", err);
        setError("Не удалось включить шифрование (E2EE)");
      });

    return () => {
      cancelled = true;
    };
  }, [room, keyProvider, config?.e2eeKey]);

  useEffect(() => {
    if (!config) {
      return;
    }

    let cancelled = false;
    // Standard data-fetching effect pattern: synchronous state resets before
    // an async request are intentional here and safely guarded by `cancelled`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);
    setToken(null);
    setServerUrl(null);

    requestToken(config.serverUrl, {
      identity: config.identity,
      roomName: config.roomName,
    })
      .then((result) => {
        if (cancelled) return;
        setToken(result.token);
        setServerUrl(result.wsUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof TokenServiceError ? err.message : "Failed to connect to token server";
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [config]);

  return { token, serverUrl, room, isLoading, error };
}
