// Loads the repo-root .env (robustly, relative to this file) and validates it with Zod.
// cwd is `server/` when run via `npm -w @arenaze/server run dev`, so we resolve the
// repo root from import.meta.url rather than trusting process.cwd().
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url)); // server/src
const repoRootEnv = path.resolve(here, '../../.env'); // -> <repo>/.env
dotenv.config({ path: repoRootEnv });

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  ACCESS_TOKEN_TTL: z.string().min(1).default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed (see errors above)');
}

export const env = parsed.data;
export type Env = typeof env;
