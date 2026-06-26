import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { quotePaise, DEVICE_TYPES, BOOKING_STATUS } from '@arenaze/shared';
import type { BookingDTO } from '@arenaze/shared';
import { query, withSerializable, withTransaction, PG } from '../db.js';
import { getAuth } from '../middleware/authn.js';
import { parse } from '../lib/validate.js';
import { ApiError, Err } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { loadBookings, nextBookingCode, resolveCustomer } from '../lib/repo.js';

const CreateSchema = z.object({
  deviceType: z.enum(DEVICE_TYPES),
  guests: z.number().int().positive().max(50),
  startAt: z.string().min(1),
  durationMinutes: z.number().int().positive().max(24 * 60),
  extendable: z.boolean().default(false),
  customer: z
    .object({
      id: z.string().uuid().optional(),
      name: z.string().max(120).optional(),
      handle: z.string().max(80).optional(),
      phone: z.string().max(40).optional(),
    })
    .nullable()
    .default(null),
  note: z.string().max(280).optional(),
  deviceIds: z.array(z.string().uuid()).optional(),
});
const ExtendSchema = z.object({ minutes: z.number().int().positive().max(12 * 60) });
const LedgerQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(BOOKING_STATUS).optional(),
});

function endOfDayUtc(iso: string): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)).toISOString();
}

export async function bookingRoutes(fastify: FastifyInstance): Promise<void> {
  // ----- POST /bookings : idempotent + serializable create -----
  fastify.post('/bookings', async (req, reply): Promise<BookingDTO> => {
    const { tenantId, userId } = getAuth(req);
    const body = parse(CreateSchema, req.body);
    const idemKey = (req.headers['idempotency-key'] as string | undefined)?.trim() || null;

    // Idempotency: a repeated key returns the original booking.
    if (idemKey) {
      const { rows } = await query<{ id: string }>(
        `SELECT id FROM bookings WHERE tenant_id = $1 AND idempotency_key = $2`,
        [tenantId, idemKey],
      );
      if (rows[0]) {
        const [existing] = await loadBookings(tenantId, { ids: [rows[0].id] });
        reply.code(200);
        return existing;
      }
    }

    const start = new Date(body.startAt).toISOString();
    const isActive = new Date(start).getTime() <= Date.now() + 1000;
    const end = body.extendable
      ? endOfDayUtc(start)
      : new Date(new Date(start).getTime() + body.durationMinutes * 60_000).toISOString();
    const status = isActive ? 'active' : 'upcoming';

    let bookingId: string;
    try {
      bookingId = await withSerializable(async (client) => {
        // Pick devices: explicit selection or auto-assign free bays of the type.
        let chosen: { id: string; rate_paise: number }[];
        if (body.deviceIds && body.deviceIds.length > 0) {
          const { rows } = await query<{ id: string; rate_paise: number }>(
            `SELECT id, rate_paise FROM devices
             WHERE tenant_id = $1 AND type = $2 AND status = 'available' AND id = ANY($3)`,
            [tenantId, body.deviceType, body.deviceIds],
            client,
          );
          if (rows.length !== body.deviceIds.length) throw Err.conflict('Some selected devices are unavailable');
          chosen = rows;
        } else {
          const { rows } = await query<{ id: string; rate_paise: number }>(
            `SELECT d.id, d.rate_paise FROM devices d
             WHERE d.tenant_id = $1 AND d.type = $2 AND d.status = 'available'
               AND NOT EXISTS (
                 SELECT 1 FROM booking_devices bd
                 WHERE bd.device_id = d.id AND bd.status IN ('upcoming','active')
                   AND bd.slot && tstzrange($3, $4, '[)'))
             ORDER BY d.sort_order, d.label
             LIMIT $5`,
            [tenantId, body.deviceType, start, end, body.guests],
            client,
          );
          chosen = rows;
        }
        if (chosen.length < body.guests) throw Err.slotTaken('Not enough free devices for that slot');
        chosen = chosen.slice(0, body.guests);

        const customerId = await resolveCustomer(client, tenantId, body.customer);
        const code = await nextBookingCode(client);
        const total = chosen.reduce((sum, d) => sum + quotePaise(body.durationMinutes, d.rate_paise), 0);

        const { rows: bk } = await query<{ id: string }>(
          `INSERT INTO bookings
             (tenant_id, code, customer_id, guests, start_at, end_at, status, extendable, total_paise, note, idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [tenantId, code, customerId, body.guests, start, end, status, body.extendable, total, body.note ?? null, idemKey, userId],
          client,
        );
        const newId = bk[0].id;

        const playerLabel = body.customer?.name ?? body.customer?.handle ?? 'Walk-in';
        for (const d of chosen) {
          const { rows: bd } = await query<{ id: string }>(
            `INSERT INTO booking_devices (tenant_id, booking_id, device_id, start_at, end_at, status, rate_paise)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [tenantId, newId, d.id, start, end, status, d.rate_paise],
            client,
          );
          if (isActive) {
            await query(
              `INSERT INTO sessions (tenant_id, device_id, booking_id, booking_device_id, customer_id, player_label, rate_paise, started_at, planned_end_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8)`,
              [tenantId, d.id, newId, bd[0].id, customerId, playerLabel, d.rate_paise, end],
              client,
            );
          }
        }
        await audit(client, { tenantId, userId, action: 'booking.create', entity: 'booking', entityId: newId, meta: { guests: body.guests, deviceType: body.deviceType, status } });
        return newId;
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const code = PG.code(err);
      if (code === PG.EXCLUSION_VIOLATION || code === PG.SERIALIZATION_FAILURE) throw Err.slotTaken();
      if (code === PG.UNIQUE_VIOLATION && idemKey) {
        const { rows } = await query<{ id: string }>(
          `SELECT id FROM bookings WHERE tenant_id = $1 AND idempotency_key = $2`,
          [tenantId, idemKey],
        );
        if (rows[0]) {
          const [existing] = await loadBookings(tenantId, { ids: [rows[0].id] });
          reply.code(200);
          return existing;
        }
      }
      throw err;
    }

    const [created] = await loadBookings(tenantId, { ids: [bookingId] });
    reply.code(201);
    return created;
  });

  // ----- POST /bookings/:id/start : check-in (upcoming -> active) -----
  fastify.post('/bookings/:id/start', async (req): Promise<BookingDTO> => {
    const { tenantId, userId } = getAuth(req);
    const { id } = req.params as { id: string };
    await withTransaction(async (client) => {
      const { rows } = await query<{ id: string; status: string }>(
        `SELECT id, status FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
        client,
      );
      const b = rows[0];
      if (!b) throw Err.notFound('Booking not found');
      if (b.status !== 'upcoming') throw Err.invalidTransition(`Cannot start a ${b.status} booking`);

      await query(`UPDATE bookings SET status = 'active' WHERE id = $1`, [id], client);
      const { rows: bds } = await query<{ id: string; device_id: string; rate_paise: number; end_at: string }>(
        `SELECT id, device_id, rate_paise, end_at FROM booking_devices WHERE booking_id = $1 AND status = 'upcoming'`,
        [id],
        client,
      );
      for (const bd of bds) {
        await query(`UPDATE booking_devices SET status = 'active' WHERE id = $1`, [bd.id], client);
        await query(
          `INSERT INTO sessions (tenant_id, device_id, booking_id, booking_device_id, customer_id, player_label, rate_paise, started_at, planned_end_at)
           SELECT $1, $2, $3, $4, b.customer_id, COALESCE(c.name, 'Guest'), $5, now(), $6
           FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id WHERE b.id = $3`,
          [tenantId, bd.device_id, id, bd.id, bd.rate_paise, bd.end_at],
          client,
        );
      }
      await audit(client, { tenantId, userId, action: 'booking.start', entity: 'booking', entityId: id });
    }).catch((err) => {
      if (PG.code(err) === PG.UNIQUE_VIOLATION) throw Err.conflict('A device already has an active session');
      throw err;
    });
    const [b] = await loadBookings(tenantId, { ids: [id] });
    return b;
  });

  // ----- POST /bookings/:id/extend -----
  fastify.post('/bookings/:id/extend', async (req): Promise<BookingDTO> => {
    const { tenantId, userId } = getAuth(req);
    const { id } = req.params as { id: string };
    const body = parse(ExtendSchema, req.body);
    await withTransaction(async (client) => {
      const { rows } = await query<{ id: string; status: string }>(
        `SELECT id, status FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
        client,
      );
      const b = rows[0];
      if (!b) throw Err.notFound('Booking not found');
      if (b.status !== 'upcoming' && b.status !== 'active') throw Err.invalidTransition(`Cannot extend a ${b.status} booking`);
      const mins = String(body.minutes);
      await query(`UPDATE booking_devices SET end_at = end_at + ($2 || ' minutes')::interval WHERE booking_id = $1 AND status IN ('upcoming','active')`, [id, mins], client);
      await query(`UPDATE bookings SET end_at = end_at + ($2 || ' minutes')::interval WHERE id = $1`, [id, mins], client);
      await query(`UPDATE sessions SET planned_end_at = COALESCE(planned_end_at, now()) + ($2 || ' minutes')::interval WHERE booking_id = $1 AND ended_at IS NULL`, [id, mins], client);
      await audit(client, { tenantId, userId, action: 'booking.extend', entity: 'booking', entityId: id, meta: { minutes: body.minutes } });
    }).catch((err) => {
      if (PG.code(err) === PG.EXCLUSION_VIOLATION) throw Err.conflict('Extension overlaps another booking on a device');
      throw err;
    });
    const [b] = await loadBookings(tenantId, { ids: [id] });
    return b;
  });

  // ----- POST /bookings/:id/cancel -----
  fastify.post('/bookings/:id/cancel', async (req): Promise<BookingDTO> => {
    const { tenantId, userId } = getAuth(req);
    const { id } = req.params as { id: string };
    await withTransaction(async (client) => {
      const { rows } = await query<{ id: string; status: string }>(
        `SELECT id, status FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
        client,
      );
      const b = rows[0];
      if (!b) throw Err.notFound('Booking not found');
      if (b.status === 'completed' || b.status === 'cancelled') throw Err.invalidTransition(`Booking is already ${b.status}`);
      await query(`UPDATE booking_devices SET status = 'cancelled' WHERE booking_id = $1 AND status IN ('upcoming','active')`, [id], client);
      // End any running sessions without charge (cancellation).
      await query(`UPDATE sessions SET ended_at = now(), accrued_paise = COALESCE(accrued_paise, 0) WHERE booking_id = $1 AND ended_at IS NULL`, [id], client);
      await query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [id], client);
      await audit(client, { tenantId, userId, action: 'booking.cancel', entity: 'booking', entityId: id });
    });
    const [b] = await loadBookings(tenantId, { ids: [id] });
    return b;
  });

  // ----- GET /bookings : the ledger (Epic D) -----
  fastify.get('/bookings', async (req): Promise<BookingDTO[]> => {
    const { tenantId } = getAuth(req);
    const q = parse(LedgerQuerySchema, req.query);
    return loadBookings(tenantId, { from: q.from, to: q.to, status: q.status, limit: 500 });
  });
}
