// Role gate preHandler. requireRole('admin') -> 403 for everyone else.
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@arenaze/shared';
import { Err } from '../lib/errors.js';
import { getAuth } from './authn.js';

export function requireRole(...roles: Role[]) {
  return async function roleGate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const auth = getAuth(req);
    if (!roles.includes(auth.role)) throw Err.forbidden();
  };
}
