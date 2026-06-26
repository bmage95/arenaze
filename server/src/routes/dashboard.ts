import type { FastifyInstance } from 'fastify';
import type { DashboardTiles } from '@arenaze/shared';
import { query } from '../db.js';
import { getAuth } from '../middleware/authn.js';

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/dashboard/tiles', async (req): Promise<DashboardTiles> => {
    const { tenantId } = getAuth(req);
    const { rows } = await query<{ capacity: string; active: string; free: string; reserved: string; revenue: string }>(
      `SELECT
         (SELECT count(*) FROM devices WHERE tenant_id = $1 AND status <> 'maintenance') AS capacity,
         (SELECT count(*) FROM sessions WHERE tenant_id = $1 AND ended_at IS NULL) AS active,
         (SELECT count(*) FROM devices d WHERE d.tenant_id = $1 AND d.status = 'available'
            AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.device_id = d.id AND s.ended_at IS NULL)) AS free,
         (SELECT count(DISTINCT b.id) FROM bookings b
            WHERE b.tenant_id = $1 AND b.status = 'upcoming' AND b.start_at::date = now()::date) AS reserved,
         (SELECT COALESCE(sum(amount_paise), 0) FROM transactions
            WHERE tenant_id = $1 AND created_at::date = now()::date) AS revenue`,
      [tenantId],
    );
    const r = rows[0];
    const capacity = Number(r.capacity);
    const active = Number(r.active);
    return {
      occupancyRate: capacity > 0 ? Math.round((active / capacity) * 100) : 0,
      activeCount: active,
      capacity,
      freeCount: Number(r.free),
      reservedCount: Number(r.reserved),
      revenueTodayPaise: Number(r.revenue),
    };
  });
}
