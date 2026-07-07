import { AccessToken } from 'livekit-server-sdk';
import type { AppConfig } from './config.js';

export type CreateTokenParams = {
  identity: string;
  roomName: string;
};

export type CreateTokenResult = {
  token: string;
  wsUrl: string;
};

/**
 * Generates a short-lived, one-time LiveKit access token (JWT).
 * No token or session state is stored server-side.
 */
export async function createAccessToken(
  config: Pick<AppConfig, 'livekitApiKey' | 'livekitApiSecret' | 'livekitUrl' | 'tokenTtlSeconds'>,
  { identity, roomName }: CreateTokenParams,
): Promise<CreateTokenResult> {
  if (!identity.trim()) {
    throw new Error('identity is required');
  }
  if (!roomName.trim()) {
    throw new Error('roomName is required');
  }

  const accessToken = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity,
    ttl: config.tokenTtlSeconds,
  });

  accessToken.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await accessToken.toJwt();

  return {
    token,
    wsUrl: config.livekitUrl,
  };
}
