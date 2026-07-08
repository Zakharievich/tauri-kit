import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const envSchema = z.object({
  LIVEKIT_API_KEY: z.string().min(1, 'LIVEKIT_API_KEY is required'),
  LIVEKIT_API_SECRET: z.string().min(1, 'LIVEKIT_API_SECRET is required'),
  LIVEKIT_URL: z.string().min(1, 'LIVEKIT_URL is required'),
  ALLOWED_ORIGIN: z.string().min(1).default('http://localhost:1420'),
  PORT: z.coerce.number().int().positive().default(3001),
  TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
});

export type AppConfig = Readonly<{
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitUrl: string;
  allowedOrigin: string;
  port: number;
  tokenTtlSeconds: number;
}>;

function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const data = result.data;

  const isProduction = env.NODE_ENV === 'production';
  const usesDevCredentials =
    data.LIVEKIT_API_KEY === 'devkey' || data.LIVEKIT_API_SECRET === 'devsecret';

  if (isProduction && usesDevCredentials) {
    throw new Error(
      'Invalid environment configuration: LIVEKIT_API_KEY/LIVEKIT_API_SECRET use the ' +
        'well-known LiveKit dev defaults ("devkey"/"devsecret") — refusing to start with ' +
        'these credentials when NODE_ENV=production. Generate dedicated production keys.',
    );
  }

  return {
    livekitApiKey: data.LIVEKIT_API_KEY,
    livekitApiSecret: data.LIVEKIT_API_SECRET,
    livekitUrl: data.LIVEKIT_URL,
    allowedOrigin: data.ALLOWED_ORIGIN,
    port: data.PORT,
    tokenTtlSeconds: data.TOKEN_TTL_SECONDS,
  };
}


export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return parseEnv(env);
}
