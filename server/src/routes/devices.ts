import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { accruedPaise, quotePaise, DEVICE_TYPES } from '@arenaze/shared';
import type { DeviceSnapshot, StartSessionRes, EndSessionRes } from '@arenaze/shared';
import { pool, query, withTransaction, PG, type Db } from '../db.js';
import { getAuth } from '../middleware/authn.js';
import { requireRole } from '../middleware/roles.js';
import { parse } from '../lib/validate.js';
import { Err } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { nextBookingCode, resolveCustomer } from '../lib/repo.js';

interface DeviceRow {
  id: string;
  label: string;
  type: (typeof DEVICE_TYPES)[number];
  spec: string;
  rate_paise: number;
  status: 'available' | 'maintenance';
  sort_order: number;
}
interface SessionRow {
  id: string;
  device_id: string;
  player_label: string;
  customer_id: string | null;
  started_at: string;
  planned_end_at: string | null;
  rate_paise: number;
}
interface ReservationRow {
  device_id: string;
  booking_id: string;
  code: string;
  customer_name: string | null;
  start_at: string;
  end_at: string;
}

/** Build live floor snapshots: derive active/reserved status + accrued bill on read. */
export async function buildSnapshots(tenantId: string, deviceId?: string, client: Db = pool): Promise<DeviceSnapshot[]> {
  const params: unknown[] = [tenantId];
  let filter = '';
  if (deviceId) {
    params.push(deviceId);
    filter = `AND d.id = $${params.length}`;
  }
  const { rows: devices } = await query<DeviceRow>(
    `SELECT id, label, type, spec, rate_paise, status, sort_order
     FROM devices d WHERE d.tenant_id = $1 ${filter} ORDER BY d.sort_order, d.label`,
    params,
    client,
  );
  if (devices.length === 0) return [];
  const ids = devices.map((d) => d.id);

  const { rows: sessions } = await query<SessionRow>(
    `SELECT id, device_id, player_label, customer_id, started_at, planned_end_at, rate_paise
     FROM sessions WHERE tenant_id = $1 AND ended_at IS NULL AND device_id = ANY($2)`,
    [tenantId, ids],
    client,
  );
  const { rows: reservations } = await query<ReservationRow>(
    `SELECT DISTINCT ON (bd.device_id) bd.device_id, b.id AS booking_id, b.code,
            c.name AS customer_name, bd.start_at, bd.end_at
     FROM booking_devices bd
     JOIN bookings b ON b.id = bd.booking_id
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE bd.tenant_id = $1 AND bd.status = 'upcoming' AND bd.device_id = ANY($2)
       AND bd.end_at > now() AND bd.start_at < now() + interval '24 hours'
     ORDER BY bd.device_id, bd.start_at ASC`,
    [tenantId, ids],
    client,
  );

  const sessByDevice = new Map(sessions.map((s) => [s.device_id, s]));
  const resByDevice = new Map(reservations.map((r) => [r.device_id, r]));
  const nowMs = Date.now();

  return devices.map((d): DeviceSnapshot => {
    const base = { id: d.id, label: d.label, type: d.type, spec: d.spec, ratePaise: d.rate_paise };
    const s = sessByDevice.get(d.id);
    if (s) {
      const elapsedSec = Math.max(0, (nowMs - Date.parse(s.started_at)) / 1000);
      return {
        ...base,
        status: 'active',
        session: {
          id: s.id,
          playerLabel: s.player_label,
          customerId: s.customer_id,
          startedAt: s.started_at,
          plannedEndAt: s.planned_end_at,
          ratePaise: s.rate_paise,
          accruedPaise: accruedPaise(elapsedSec, s.rate_paise),
        },
        reservation: null,
      };
    }
    if (d.status === 'maintenance') {
      return { ...base, status: 'maintenance', session: null, reservation: null };
    }
    const r = resByDevice.get(d.id);
    if (r) {
      return {
        ...base,
        status: 'reserved',
        session: null,
        reservation: {
          bookingId: r.booking_id,
          code: r.code,
          customerName: r.customer_name,
          startAt: r.start_at,
          endAt: r.end_at,
        },
      };
    }
    return { ...base, status: 'available', session: null, reservation: null };
  });
}

async function snapshotOne(tenantId: string, deviceId: string, client: Db = pool): Promise<DeviceSnapshot> {
  const [snap] = await buildSnapshots(tenantId, deviceId, client);
  if (!snap) throw Err.notFound('Device not found');
  return snap;
}

const StartSchema = z.object({
  playerLabel: z.string().min(1).max(80),
  customerId: z.string().uuid().nullish(),
  durationMinutes: z.number().int().positive().max(24 * 60),
});
const ExtendSchema = z.object({ minutes: z.number().int().positive().max(12 * 60) });
const PatchSchema = z.object({
  status: z.enum(['available', 'maintenance']).optional(),
  spec: z.string().max(120).optional(),
  ratePaise: z.number().int().nonnegative().optional(),
});
const CreateSchema = z.object({
  label: z.string().min(1).max(40),
  type: z.enum(DEVICE_TYPES),
  spec: z.string().max(120).default(''),
  ratePaise: z.number().int().nonnegative(),
});

export async function deviceRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /devices — the 10s floor poll
  fastify.get('/devices', async (req): Promise<DeviceSnapshot[]> => {
    const { tenantId } = getAuth(req);
    return buildSnapshots(tenantId);
  });

  // POST /devices/:id/start — seat a single walk-in
  fastify.post('/devices/:id/start', async (req): Promise<StartSessionRes> => {
    const { tenantId, userId } = getAuth(req);
    const { id } = req.params as { id: string };
    const body = parse(StartSchema, req.body);

    const bookingId = await withTransaction(async (client) => {
      const { rows } = await query<DeviceRow>(
        `SELECT id, label, type, spec, rate_paise, status, sort_order FROM devices
         WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
        client,
      );
      const device = rows[0];
      if (!device) throw Err.notFound('Device not found');
      if (device.status === 'maintenance') throw Err.conflict('Device is in maintenance');

      const active = await query(
        `SELECT 1 FROM sessions WHERE device_id = $1 AND ended_at IS NULL`,
        [id],
        client,
      );
      if (active.rowCount) throw Err.conflict('Device already has an active session');

      const code = await nextBookingCode(client);
      const total = quotePaise(body.durationMinutes, device.rate_paise);
      const customerId = body.customerId
        ? await resolveCustomer(client, tenantId, { id: body.customerId })
        : null;

      const { rows: bk } = await query<{ id: string }>(
        `INSERT INTO bookings (tenant_id, code, customer_id, guests, start_at, end_at, status, total_paise, created_by)
         VALUES ($1, $2, $3, 1, now(), now() + ($4 || ' minutes')::interval, 'active', $5, $6)
         RETURNING id`,
        [tenantId, code, customerId, String(body.durationMinutes), total, userId],
        client,
      );
      const newBookingId = bk[0].id;

      const { rows: bd } = await query<{ id: string }>(
        `INSERT INTO booking_devices (tenant_id, booking_id, device_id, start_at, end_at, status, rate_paise)
         VALUES ($1, $2, $3, now(), now() + ($4 || ' minutes')::interval, 'active', $5)
         RETURNING id`,
        [tenantId, newBookingId, id, String(body.durationMinutes), device.rate_paise],
        client,
      );

      await query(
        `INSERT INTO sessions (tenant_id, device_id, booking_id, booking_device_id, customer_id, player_label, rate_paise, started_at, planned_end_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now() + ($8 || ' minutes')::interval)`,
        [tenantId, id, newBookingId, bd[0].id, customerId, body.playerLabel, device.rate_paise, String(body.durationMinutes)],
        client,
      );

      await audit(client, { tenantId, userId, action: 'session.start', entity: 'device', entityId: id, meta: { bookingId: newBookingId, durationMinutes: body.durationMinutes } });
      return newBookingId;
    }).catch((err) => {
      if (PG.code(err) === PG.EXCLUSION_VIOLATION) throw Err.conflict('Device is no longer free');
      throw err;
    });

    return { device: await snapshotOne(tenantId, id), bookingId };
  });

  // POST /devices/:id/end-session — checkout, finalize accrued bill
  fastify.post('/devices/:id/end-session', async (req): Promise<EndSessionRes> => {
    const { tenantId, userId } = getAuth(req);
    const { id } = req.params as { id: string };

    const result = await withTransaction(async (client) => {
      const { rows } = await query<{ id: string; started_at: string; rate_paise: number; booking_id: string | null; booking_device_id: string | null; customer_id: string | null }>(
        `SELECT id, started_at, rate_paise, booking_id, booking_device_id, customer_id
         FROM sessions WHERE device_id = $1 AND tenant_id = $2 AND ended_at IS NULL
         FOR UPDATE`,
        [id, tenantId],
        client,
      );
      const session = rows[0];
      if (!session) throw Err.conflict('No active session on this device');

      const elapsedSec = Math.max(0, (Date.now() - Date.parse(session.started_at)) / 1000);
      const charged = accruedPaise(elapsedSec, session.rate_paise);

      await query(
        `UPDATE sessions SET ended_at = now(), accrued_paise = $2 WHERE id = $1`,
        [session.id, charged],
        client,
      );
      await query(
        `INSERT INTO transactions (tenant_id, booking_id, session_id, customer_id, device_id, kind, amount_paise, note)
         VALUES ($1, $2, $3, $4, $5, 'session', $6, 'Session checkout')`,
        [tenantId, session.booking_id, session.id, session.customer_id, id, charged],
        client,
      );
      if (session.booking_device_id) {
        await query(`UPDATE booking_devices SET status = 'completed' WHERE id = $1`, [session.booking_device_id], client);
      }
      if (session.booking_id) {
        await query(
          `UPDATE bookings SET status = 'completed'
           WHERE id = $1 AND NOT EXISTS (
             SELECT 1 FROM booking_devices WHERE booking_id = $1 AND status IN ('upcoming','active'))`,
          [session.booking_id],
          client,
        );
      }
      await audit(client, { tenantId, userId, action: 'session.end', entity: 'device', entityId: id, meta: { sessionId: session.id, chargedPaise: charged } });

      return {
        deviceId: id,
        sessionId: session.id,
        chargedPaise: charged,
        durationMinutes: Math.round(elapsedSec / 60),
      } satisfies EndSessionRes;
    });

    return result;
  });

  // POST /devices/:id/extend — push the active session's end out
  fastify.post('/devices/:id/extend', async (req): Promise<DeviceSnapshot> => {
    const { tenantId, userId } = getAuth(req);
    const { id } = req.params as { id: string };
    const body = parse(ExtendSchema, req.body);

    await withTransaction(async (client) => {
      const { rows } = await query<{ id: string; booking_id: string | null; booking_device_id: string | null; planned_end_at: string | null }>(
        `SELECT id, booking_id, booking_device_id, planned_end_at FROM sessions
         WHERE device_id = $1 AND tenant_id = $2 AND ended_at IS NULL FOR UPDATE`,
        [id, tenantId],
        client,
      );
      const session = rows[0];
      if (!session) throw Err.conflict('No active session on this device');

      const mins = String(body.minutes);
      // Extending the booking_device slot may collide with a later reservation -> exclusion violation.
      if (session.booking_device_id) {
        await query(
          `UPDATE booking_devices SET end_at = end_at + ($2 || ' minutes')::interval WHERE id = $1`,
          [session.booking_device_id, mins],
          client,
        );
      }
      if (session.booking_id) {
        await query(`UPDATE bookings SET end_at = end_at + ($2 || ' minutes')::interval WHERE id = $1`, [session.booking_id, mins], client);
      }
      await query(
        `UPDATE sessions SET planned_end_at = COALESCE(planned_end_at, now()) + ($2 || ' minutes')::interval WHERE id = $1`,
        [session.id, mins],
        client,
      );
      await audit(client, { tenantId, userId, action: 'session.extend', entity: 'device', entityId: id, meta: { minutes: body.minutes } });
    }).catch((err) => {
      if (PG.code(err) === PG.EXCLUSION_VIOLATION) throw Err.conflict('Cannot extend — overlaps a later reservation');
      throw err;
    });

    return snapshotOne(tenantId, id);
  });

  // PATCH /devices/:id — admin: maintenance toggle / spec / rate
  fastify.patch('/devices/:id', { preHandler: requireRole('admin') }, async (req): Promise<DeviceSnapshot> => {
    const { tenantId, userId } = getAuth(req);
    const { id } = req.params as { id: string };
    const body = parse(PatchSchema, req.body);

    await withTransaction(async (client) => {
      const { rows } = await query<DeviceRow>(`SELECT id, status FROM devices WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId], client);
      if (!rows[0]) throw Err.notFound('Device not found');

      if (body.status === 'maintenance') {
        const active = await query(`SELECT 1 FROM sessions WHERE device_id = $1 AND ended_at IS NULL`, [id], client);
        if (active.rowCount) throw Err.conflict('Cannot set maintenance while a session is active');
      }
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [col, val] of [['status', body.status], ['spec', body.spec], ['rate_paise', body.ratePaise]] as const) {
        if (val !== undefined) {
          params.push(val);
          sets.push(`${col} = $${params.length}`);
        }
      }
      if (sets.length) await query(`UPDATE devices SET ${sets.join(', ')} WHERE id = $1`, params, client);
      await audit(client, { tenantId, userId, action: 'device.patch', entity: 'device', entityId: id, meta: body });
    });

    return snapshotOne(tenantId, id);
  });

  // POST /devices — admin: create a device
  fastify.post('/devices', { preHandler: requireRole('admin') }, async (req, reply): Promise<DeviceSnapshot> => {
    const { tenantId, userId } = getAuth(req);
    const body = parse(CreateSchema, req.body);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO devices (tenant_id, label, type, spec, rate_paise, sort_order)
       VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT max(sort_order) + 1 FROM devices WHERE tenant_id = $1), 0))
       RETURNING id`,
      [tenantId, body.label, body.type, body.spec, body.ratePaise],
    ).catch((err) => {
      if (PG.code(err) === PG.UNIQUE_VIOLATION) throw Err.conflict('A device with that label already exists');
      throw err;
    });
    await audit(pool, { tenantId, userId, action: 'device.create', entity: 'device', entityId: rows[0].id, meta: body });
    reply.code(201);
    return snapshotOne(tenantId, rows[0].id);
  });
}
