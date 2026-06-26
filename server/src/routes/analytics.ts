import type { FastifyInstance } from 'fastify';
import type { AnalyticsOverview } from '@arenaze/shared';
import { query } from '../db.js';
import { getAuth } from '../middleware/authn.js';
import { requireRole } from '../middleware/roles.js';

// 12 buckets, noon → 11pm, in IST (the seed stores IST wall-clock as UTC instants).
const HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const hourLabel = (h: number): string => (h === 12 ? '12p' : h === 23 ? '11p' : String(h - 12));

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/analytics/overview', { preHandler: requireRole('admin') }, async (req): Promise<AnalyticsOverview> => {
    const { tenantId } = getAuth(req);

    const [cap, util, revDay, metrics] = await Promise.all([
      query<{ capacity: string }>(`SELECT count(*) AS capacity FROM devices WHERE tenant_id = $1 AND status <> 'maintenance'`, [tenantId]),
      query<{ h: number; c: string }>(
        `SELECT h.hh AS h, COALESCE(cnt.c, 0) AS c
         FROM generate_series(12, 23) AS h(hh)
         LEFT JOIN (
           SELECT EXTRACT(HOUR FROM started_at AT TIME ZONE 'Asia/Kolkata')::int AS hh, count(*) AS c
           FROM sessions
           WHERE tenant_id = $1 AND (started_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
           GROUP BY 1
         ) cnt ON cnt.hh = h.hh
         ORDER BY h.hh`,
        [tenantId],
      ),
      query<{ label: string; rev: string }>(
        `SELECT to_char(d, 'Dy') AS label, COALESCE(sum(t.amount_paise), 0) AS rev
         FROM generate_series(now()::date - interval '6 days', now()::date, interval '1 day') AS d
         LEFT JOIN transactions t ON t.tenant_id = $1 AND t.created_at::date = d::date
         GROUP BY d ORDER BY d`,
        [tenantId],
      ),
      query<{ revenue: string; sessions_today: string; avg_minutes: string; avg_ticket: string; active: string }>(
        `SELECT
           (SELECT COALESCE(sum(amount_paise), 0) FROM transactions WHERE tenant_id = $1 AND created_at::date = now()::date) AS revenue,
           (SELECT count(*) FROM sessions WHERE tenant_id = $1 AND started_at::date = now()::date) AS sessions_today,
           (SELECT COALESCE(avg(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60), 0)
              FROM sessions WHERE tenant_id = $1 AND ended_at IS NOT NULL AND started_at::date = now()::date) AS avg_minutes,
           (SELECT COALESCE(avg(amount_paise), 0) FROM transactions WHERE tenant_id = $1 AND created_at::date = now()::date) AS avg_ticket,
           (SELECT count(*) FROM sessions WHERE tenant_id = $1 AND ended_at IS NULL) AS active`,
        [tenantId],
      ),
    ]);

    const capacity = Number(cap.rows[0]?.capacity ?? 0);
    const utilByCount = new Map(util.rows.map((r) => [r.h, Number(r.c)]));

    const utilByHour = HOURS.map((h) => {
      const count = utilByCount.get(h) ?? 0;
      const value = capacity > 0 ? Math.min(100, Math.round((count / capacity) * 100)) : 0;
      return { hour: hourLabel(h), value };
    });

    const revenueByDay = revDay.rows.map((r) => ({ day: r.label.trim(), valuePaise: Number(r.rev) }));

    const m = metrics.rows[0];
    const active = Number(m.active);
    return {
      utilByHour,
      revenueByDay,
      metrics: {
        utilizationNow: capacity > 0 ? Math.round((active / capacity) * 100) : 0,
        revenueTodayPaise: Number(m.revenue),
        sessionsToday: Number(m.sessions_today),
        avgSessionMinutes: Math.round(Number(m.avg_minutes)),
        avgTicketPaise: Math.round(Number(m.avg_ticket)),
      },
    };
  });
}
