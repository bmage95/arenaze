// Typed, structured config derived from the validated env.
import type { SignOptions } from 'jsonwebtoken';
import { env } from './env.js';

export const config = {
  databaseUrl: env.DATABASE_URL,
  port: env.PORT,
  host: env.HOST,
  webOrigin: env.WEB_ORIGIN,
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    // jsonwebtoken's expiresIn is `StringValue | number`; '15m' is a StringValue.
    accessTtl: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
  },
  refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
} as const;

export type Config = typeof config;
