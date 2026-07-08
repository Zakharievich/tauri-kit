import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config.js';
import { createAccessToken } from './tokenService.js';

type TokenRequestBody = {
  identity?: unknown;
  roomName?: unknown;
};

export function buildServer(config = loadConfig()) {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: config.allowedOrigin,
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
    await app.listen({ port: 3001, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
