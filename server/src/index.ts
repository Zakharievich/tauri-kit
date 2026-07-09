import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { loadConfig } from './config.js';
import { createAccessToken } from './tokenService.js';

type TokenRequestBody = {
  identity?: unknown;
  roomName?: unknown;
};

export function buildServer(config = loadConfig()) {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: config.allowedOrigins,
  });

  // The endpoint mints LiveKit access tokens for anyone who can reach it —
  // there's no per-user auth in front of it (see docs/PLAN.md 4.1). A basic
  // rate limit at least bounds how fast one client can mint tokens/probe
  // room names.
  app.register(rateLimit, {
    max: 20,
    timeWindow: '1 minute',
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post<{ Body: TokenRequestBody }>('/token', async (request, reply) => {
    const { identity, roomName } = request.body ?? {};

    if (typeof identity !== 'string' || !identity.trim()) {
      return reply.status(400).send({ error: 'identity is required' });
    }
    if (typeof roomName !== 'string' || !roomName.trim()) {
      return reply.status(400).send({ error: 'roomName is required' });
    }

    try {
      const result = await createAccessToken(config, { identity, roomName });
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to create access token');
      return reply.status(500).send({ error: 'Failed to create access token' });
    }
  });

  return app;
}

async function main() {
  const config = loadConfig();
  const app = buildServer(config);

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
