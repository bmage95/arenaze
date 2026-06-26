// Refresh-token store: opaque random token, only its sha-256 hash is persisted.
// Tokens are rotated on use (old one revoked) and revocable on logout.
import crypto from 'node:crypto';
import { query, type Db } from '../db.js';
import { config } from '../config.js';

const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

export async function issueRefresh(userId: string, tenantId: string, client?: Db): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.refreshTtlDays * 86_400_000).toISOString();
  await query(
    `INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, tenantId, sha256(token), expiresAt],
    client,
  );
  return token;
}

export interface RefreshOwner {
  userId: string;
  tenantId: string;
}

/** Validate a refresh token, revoke it, and issue a fresh one (rotation). */
export async function verifyAndRotate(token: string): Promise<{ token: string; owner: RefreshOwner } | null> {
  const { rows } = await query<{ id: string; user_id: string; tenant_id: string }>(
    `SELECT id, user_id, tenant_id FROM refresh_tokens
     WHERE token_hash = $1 AND revoked = false AND expires_at > now()`,
    [sha256(token)],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  await query(`UPDATE refresh_tokens SET revoked = true WHERE id = $1`, [row.id]);
  const fresh = await issueRefresh(row.user_id, row.tenant_id);
  return { token: fresh, owner: { userId: row.user_id, tenantId: row.tenant_id } };
}

export async function revokeRefresh(token: string): Promise<void> {
  await query(`UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1`, [sha256(token)]);
}
