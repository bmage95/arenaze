import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PAYMENT_METHODS,
  INVOICE_STATUS,
  type AnalyticsOverview,
  type InvoiceDTO,
  type InvoiceDetail,
  type InvoiceListRes,
  type InvoiceSummary,
} from '@arenaze/shared';
import { pool, query } from '../db.js';
import { getAuth } from '../middleware/authn.js';
import { requireRole } from '../middleware/roles.js';
import { parse } from '../lib/validate.js';
import { Err } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { loadBookings } from '../lib/repo.js';

// 12 buckets, noon → 11pm, in IST (the seed stores IST wall-clock as UTC instants).
const HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const hourLabel = (h: number): string => (h === 12 ? '12p' : h === 23 ? '11p' : String(h - 12));

// ---- Account ledger row -> InvoiceDTO -------------------------------------
interface InvoiceRow {
  id: string;
  invoice_no: string;
  customer_id: string | null;
  customer_name: string | null;
  booking_id: string | null;
  booking_code: string | null;
  kind: 'session' | 'booking' | 'refund';
  amount_paise: number;
  method: (typeof PAYMENT_METHODS)[number];
  status: (typeof INVOICE_STATUS)[number];
  created_at: string;
}

const INVOICE_COLS = `t.id, t.invoice_no, t.customer_id, c.name AS customer_name,
       t.booking_id, b.code AS booking_code, t.kind, t.amount_paise,
       t.method, t.status, t.created_at`;
const INVOICE_FROM = `FROM transactions t
     LEFT JOIN customers c ON c.id = t.customer_id
     LEFT JOIN bookings b ON b.id = t.booking_id`;

function toInvoiceDTO(r: InvoiceRow): InvoiceDTO {
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    customerId: r.customer_id,
    customerName: r.customer_name,
    bookingId: r.booking_id,
    bookingCode: r.booking_code,
    kind: r.kind,
    amountPaise: Number(r.amount_paise),
    method: r.method,
    status: r.status,
    paidAt: r.created_at,
  };
}

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

  // ----- GET /analytics/invoices : the account ledger -----
  const ListQuery = z.object({
    period: z.enum(['day', 'month', 'year', 'all']).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    status: z.enum(INVOICE_STATUS).optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    q: z.string().optional(),
  });

  fastify.get('/analytics/invoices', { preHandler: requireRole('admin') }, async (req): Promise<InvoiceListRes> => {
    const { tenantId } = getAuth(req);
    const f = parse(ListQuery, req.query);

    const where: string[] = ['t.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (f.period && f.period !== 'all') {
      where.push(
        f.period === 'day'
          ? `t.created_at::date = now()::date`
          : `date_trunc('${f.period}', t.created_at) = date_trunc('${f.period}', now())`,
      );
    }
    if (f.from) {
      params.push(f.from);
      where.push(`t.created_at::date >= $${params.length}`);
    }
    if (f.to) {
      params.push(f.to);
      where.push(`t.created_at::date <= $${params.length}`);
    }
    if (f.status) {
      params.push(f.status);
      where.push(`t.status = $${params.length}`);
    }
    if (f.method) {
      params.push(f.method);
      where.push(`t.method = $${params.length}`);
    }
    if (f.q && f.q.trim()) {
      params.push(`%${f.q.trim().toLowerCase()}%`);
      where.push(`(lower(t.invoice_no) LIKE $${params.length} OR lower(c.name) LIKE $${params.length})`);
    }

    const { rows } = await query<InvoiceRow>(
      `SELECT ${INVOICE_COLS} ${INVOICE_FROM}
       WHERE ${where.join(' AND ')}
       ORDER BY t.created_at DESC
       LIMIT 1000`,
      params,
    );

    const invoices = rows.map(toInvoiceDTO);
    const summary = invoices.reduce<InvoiceSummary>(
      (acc, inv) => {
        acc.count += 1;
        acc.totalPaise += inv.amountPaise;
        if (inv.status === 'paid') acc.paidPaise += inv.amountPaise;
        else acc.pendingPaise += inv.amountPaise;
        return acc;
      },
      { count: 0, totalPaise: 0, paidPaise: 0, pendingPaise: 0 },
    );

    return { invoices, summary };
  });

  // ----- GET /analytics/invoices/:id : the entire bill -----
  fastify.get('/analytics/invoices/:id', { preHandler: requireRole('admin') }, async (req): Promise<InvoiceDetail> => {
    const { tenantId } = getAuth(req);
    const { id } = req.params as { id: string };
    const { rows } = await query<InvoiceRow & { note: string | null; device_label: string | null }>(
      `SELECT ${INVOICE_COLS}, t.note, d.label AS device_label ${INVOICE_FROM}
       LEFT JOIN devices d ON d.id = t.device_id
       WHERE t.id = $1 AND t.tenant_id = $2`,
      [id, tenantId],
    );
    const row = rows[0];
    if (!row) throw Err.notFound('Invoice not found');
    const booking = row.booking_id ? (await loadBookings(tenantId, { ids: [row.booking_id] }))[0] ?? null : null;
    return { ...toInvoiceDTO(row), note: row.note, deviceLabel: row.device_label, booking };
  });

  // ----- PATCH /analytics/invoices/:id : settle a pending invoice -----
  const StatusSchema = z.object({ status: z.enum(INVOICE_STATUS) });
  fastify.patch('/analytics/invoices/:id', { preHandler: requireRole('admin') }, async (req): Promise<InvoiceDTO> => {
    const { tenantId, userId } = getAuth(req);
    const { id } = req.params as { id: string };
    const body = parse(StatusSchema, req.body);

    const upd = await query(`UPDATE transactions SET status = $3 WHERE id = $1 AND tenant_id = $2`, [id, tenantId, body.status]);
    if (!upd.rowCount) throw Err.notFound('Invoice not found');

    const { rows } = await query<InvoiceRow>(
      `SELECT ${INVOICE_COLS} ${INVOICE_FROM} WHERE t.id = $1 AND t.tenant_id = $2`,
      [id, tenantId],
    );
    await audit(pool, { tenantId, userId, action: 'invoice.status', entity: 'transaction', entityId: id, meta: { status: body.status } });
    return toInvoiceDTO(rows[0]);
  });
}
