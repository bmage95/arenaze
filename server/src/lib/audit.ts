// Audit log — one row per mutation. Pass the txn client when inside a transaction
// so the audit row commits/rolls back atomically with the change.
import { query, type Db } from '../db.js';

export interface AuditEntry {
  tenantId: string;
  userId?: string | null;
  action: string; // 'booking.create', 'session.end', 'device.patch', ...
  entity?: string; // 'booking' | 'device' | 'session' | ...
  entityId?: string | null;
  meta?: Record<string, unknown>;
}

export async function audit(client: Db, e: AuditEntry): Promise<void> {
  await query(
    `INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, meta)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.tenantId, e.userId ?? null, e.action, e.entity ?? '', e.entityId ?? null, JSON.stringify(e.meta ?? {})],
    client,
  );
}
