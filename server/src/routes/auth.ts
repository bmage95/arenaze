import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthUser, LoginRes, RefreshRes, Role } from '@arenaze/shared';
import { pool, query } from '../db.js';
import { verify as verifyPassword } from '../auth/password.js';
import { signAccess } from '../auth/jwt.js';
import { issueRefresh, verifyAndRotate, revokeRefresh } from '../auth/refresh.js';
import { parse } from '../lib/validate.js';
import { Err } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const LoginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
const RefreshSchema = z.object({ refreshToken: z.string().min(1) });
const LogoutSchema = z.object({ refreshToken: z.string().min(1) });
const ForgotSchema = z.object({ username: z.string().min(1) });

interface UserRow {
  id: string;
  tenant_id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: Role;
  tenant_name: string;
}

const USER_SELECT = `
  SELECT u.id, u.tenant_id, u.username, u.password_hash, u.display_name, u.role, t.name AS tenant_name
  FROM users u JOIN tenants t ON t.id = u.tenant_id`;

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/login', async (req): Promise<LoginRes> => {
    const body = parse(LoginSchema, req.body);
    const { rows } = await query<UserRow>(`${USER_SELECT} WHERE u.username = $1 LIMIT 1`, [body.username]);
    const user = rows[0];
    // Verify even when the user is missing? We short-circuit; timing is acceptable for this app.
    if (!user || !(await verifyPassword(user.password_hash, body.password))) {
      throw Err.unauthorized('Invalid username or password');
    }
    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
    };
    const accessToken = signAccess({
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      username: user.username,
      displayName: user.display_name,
      tenantName: user.tenant_name,
    });
    const refreshToken = await issueRefresh(user.id, user.tenant_id);
    await audit(pool, { tenantId: user.tenant_id, userId: user.id, action: 'auth.login', entity: 'user', entityId: user.id });
    return { accessToken, refreshToken, user: authUser };
  });

  fastify.post('/refresh', async (req): Promise<RefreshRes> => {
    const body = parse(RefreshSchema, req.body);
    const rotated = await verifyAndRotate(body.refreshToken);
    if (!rotated) throw Err.unauthorized('Invalid or expired refresh token');
    const { rows } = await query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [rotated.owner.userId]);
    const u = rows[0];
    if (!u) throw Err.unauthorized();
    const accessToken = signAccess({
      sub: u.id,
      tenantId: u.tenant_id,
      role: u.role,
      username: u.username,
      displayName: u.display_name,
      tenantName: u.tenant_name,
    });
    return { accessToken, refreshToken: rotated.token };
  });

  fastify.post('/logout', async (req): Promise<{ ok: true }> => {
    const body = parse(LogoutSchema, req.body);
    await revokeRefresh(body.refreshToken);
    return { ok: true };
  });

  // Always 200 (no user enumeration). In this demo we just log a fake reset token.
  fastify.post('/forgot-password', async (req): Promise<{ ok: true }> => {
    const body = parse(ForgotSchema, req.body);
    const resetToken = crypto.randomBytes(16).toString('hex');
    req.log.info({ username: body.username, resetToken }, '[demo] password reset requested');
    return { ok: true };
  });
}
