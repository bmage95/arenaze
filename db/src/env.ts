// Loads the repo-root .env robustly, regardless of cwd (scripts run with cwd=db/
// when invoked via `npm -w @arenaze/db run ...`). Resolved from this file's URL.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
// db/src/env.ts -> repo root is two levels up.
export const ENV_PATH = resolve(here, '../../.env');
export const MIGRATIONS_DIR = resolve(here, '../migrations');

dotenvConfig({ path: ENV_PATH });

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(`[db] DATABASE_URL is not set. Looked for .env at: ${ENV_PATH}`);
    process.exit(1);
  }
  return url;
}
