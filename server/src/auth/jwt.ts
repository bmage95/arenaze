// HS256 access tokens. Claims carry everything the request context needs so no
// per-request DB lookup is required for authn.
import jwt from 'jsonwebtoken';
import type { Role } from '@arenaze/shared';
import { config } from '../config.js';

export interface AccessClaims {
  sub: string; // userId
  tenantId: string;
  role: Role;
  username: string;
  displayName: string;
  tenantName: string;
}

export function signAccess(claims: AccessClaims): string {
  return jwt.sign(claims, config.jwt.accessSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwt.accessTtl,
  });
}

export function verifyAccess(token: string): AccessClaims {
  const decoded = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('Malformed access token');
  const d = decoded as jwt.JwtPayload;
  if (!d.sub || !d.tenantId || !d.role || !d.username) {
    throw new Error('Access token missing required claims');
  }
  return {
    sub: String(d.sub),
    tenantId: String(d.tenantId),
    role: d.role as Role,
    username: String(d.username),
    displayName: String(d.displayName ?? ''),
    tenantName: String(d.tenantName ?? ''),
  };
}
