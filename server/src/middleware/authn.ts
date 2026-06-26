// Bearer access-token authentication preHandler. Attaches req.auth.
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@arenaze/shared';
import { verifyAccess } from '../auth/jwt.js';
import { Err } from '../lib/errors.js';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
  username: string;
  displayName: string;
  tenantName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export async function authn(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) throw Err.unauthorized();
  const token = header.slice('Bearer '.length).trim();
  let claims;
  try {
    claims = verifyAccess(token);
  } catch {
    throw Err.unauthorized('Invalid or expired access token');
  }
  req.auth = {
    userId: claims.sub,
    tenantId: claims.tenantId,
    role: claims.role,
    username: claims.username,
    displayName: claims.displayName,
    tenantName: claims.tenantName,
  };
}

/** Read req.auth or throw — use inside handlers registered with the authn preHandler. */
export function getAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw Err.unauthorized();
  return req.auth;
}
