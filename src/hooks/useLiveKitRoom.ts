import { useEffect, useState } from "react";
import type { RoomOptions } from "livekit-client";
import { requestToken, TokenServiceError } from "../services/tokenService";
import { createE2EEOptions } from "../services/e2eeService";
import type { SessionConfig } from "../types";

export type UseLiveKitRoomState = {
  token: string | null;
  serverUrl: string | null;
  roomOptions: RoomOptions;
  isLoading: boolean;
  error: string | null;
};

/**
 * Prepares everything <LiveKitRoom> needs before it can mount:
 * - a fresh one-time token (via tokenService)
 * - RoomOptions, including optional E2EE key provider
 *
 * The E2EE key never leaves the client, is never logged and never sent
 * to the token server (HIGH RISK 4.2).
 */
export function useLiveKitRoom(config: SessionConfig | null): UseLiveKitRoomState {
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const roomOptions: RoomOptions = {
    e2ee: createE2EEOptions(config?.e2eeKey),
  };

  return { token, serverUrl, roomOptions, isLoading, error };
}
