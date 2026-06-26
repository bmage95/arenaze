import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CustomerDTO, CustomerDetail, CustomerTier } from '@arenaze/shared';
import { query } from '../db.js';
import { getAuth } from '../middleware/authn.js';
import { parse } from '../lib/validate.js';
import { Err } from '../lib/errors.js';
import { loadBookings } from '../lib/repo.js';

interface CustomerRow {
  id: string;
  name: string;
  handle: string;
  phone: string | null;
  tier: CustomerTier;
  visits: string;
  spend: string;
  hours: string;
  last_seen: string | null;
}

const SELECT = `
  SELECT c.id, c.name, c.handle, c.phone, c.tier,
    (SELECT count(*) FROM bookings b WHERE b.customer_id = c.id) AS visits,
    (SELECT COALESCE(sum(t.amount_paise), 0) FROM transactions t WHERE t.customer_id = c.id) AS spend,
    (SELECT COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at))) / 3600, 0)
       FROM sessions s WHERE s.customer_id = c.id) AS hours,
    GREATEST(
      (SELECT max(s.started_at) FROM sessions s WHERE s.customer_id = c.id),
      (SELECT max(b.start_at) FROM bookings b WHERE b.customer_id = c.id)
    ) AS last_seen
  FROM customers c
  WHERE c.tenant_id = $1`;

function toDTO(r: CustomerRow): CustomerDTO {
  return {
    id: r.id,
    name: r.name,
    handle: r.handle,
    phone: r.phone,
    tier: r.tier,
    visits: Number(r.visits),
    spendPaise: Number(r.spend),
    hours: Math.round(Number(r.hours)),
    lastSeen: r.last_seen,
  };
}

const QuerySchema = z.object({ q: z.string().optional() });

export async function customerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/customers', async (req): Promise<CustomerDTO[]> => {
    const { tenantId } = getAuth(req);
    const { q } = parse(QuerySchema, req.query);
    if (q && q.trim()) {
      const like = `%${q.trim().toLowerCase()}%`;
      const { rows } = await query<CustomerRow>(
        `${SELECT} AND (lower(c.name) LIKE $2 OR lower(c.handle) LIKE $2) ORDER BY spend DESC, c.name`,
        [tenantId, like],
      );
      return rows.map(toDTO);
    }
    const { rows } = await query<CustomerRow>(`${SELECT} ORDER BY spend DESC, c.name`, [tenantId]);
    return rows.map(toDTO);
  });

  fastify.get('/customers/:id', async (req): Promise<CustomerDetail> => {
    const { tenantId } = getAuth(req);
    const { id } = req.params as { id: string };
    const { rows } = await query<CustomerRow>(`${SELECT} AND c.id = $2`, [tenantId, id]);
    const row = rows[0];
    if (!row) throw Err.notFound('Customer not found');
    const bookings = await loadBookings(tenantId, { customerId: id, limit: 100 });
    return { ...toDTO(row), bookings };
  });
}
