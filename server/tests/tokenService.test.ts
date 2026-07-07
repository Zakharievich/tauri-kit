import { describe, it, expect } from 'vitest';
import { createAccessToken } from '../src/tokenService.js';
import type { AppConfig } from '../src/config.js';

const testConfig: Pick<AppConfig, 'livekitApiKey' | 'livekitApiSecret' | 'livekitUrl' | 'tokenTtlSeconds'> = {
  livekitApiKey: 'test-api-key',
  livekitApiSecret: 'test-api-secret-that-is-long-enough',
  livekitUrl: 'wss://test.livekit.cloud',
  tokenTtlSeconds: 3600,
};

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  if (!payload) {
    throw new Error('Invalid JWT: missing payload segment');
  }
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const json = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json);
}

describe('tokenService.createAccessToken', () => {
  it('generates a non-empty JWT and returns the configured wsUrl', async () => {
    const result = await createAccessToken(testConfig, {
      identity: 'alice',
      roomName: 'room-1',
    });

    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(0);
    expect(result.token.split('.')).toHaveLength(3);
    expect(result.wsUrl).toBe(testConfig.livekitUrl);
  });

  it('embeds correct identity and room grant claims', async () => {
    const result = await createAccessToken(testConfig, {
      identity: 'bob',
      roomName: 'room-42',
    });

    const payload = decodeJwtPayload(result.token);

    expect(payload.sub).toBe('bob');
    expect(payload.video).toMatchObject({
      room: 'room-42',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
  });

  it('sets TTL to exactly the configured duration (1 hour by default)', async () => {
    const result = await createAccessToken(testConfig, {
      identity: 'carol',
      roomName: 'room-ttl',
    });

    const payload = decodeJwtPayload(result.token);
    // livekit-server-sdk sets `nbf` (not-before, issuance time) and `exp`
    // (expiration); there is no separate `iat` claim in the generated JWT.
    const nbf = payload.nbf as number;
    const exp = payload.exp as number;

    expect(exp - nbf).toBe(testConfig.tokenTtlSeconds);
  });

  it('rejects empty identity or roomName', async () => {
    await expect(
      createAccessToken(testConfig, { identity: '', roomName: 'room-1' }),
    ).rejects.toThrow(/identity/);

    await expect(
      createAccessToken(testConfig, { identity: 'dave', roomName: '' }),
    ).rejects.toThrow(/roomName/);
  });
});
