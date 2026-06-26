import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { quotePaise, DEVICE_TYPES } from '@arenaze/shared';
import type { AvailabilitySearchRes, AvailabilityMatch, AvailabilitySlot, DeviceType } from '@arenaze/shared';
import { pool, query, type Db } from '../db.js';
import { getAuth } from '../middleware/authn.js';
import { parse } from '../lib/validate.js';

const SearchSchema = z.object({
  deviceType: z.enum(DEVICE_TYPES),
  guests: z.number().int().positive().max(50),
  startAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
  durationMinutes: z.number().int().positive().max(24 * 60),
  extendable: z.boolean().default(false),
});

interface FreeRow {
  id: string;
  label: string;
  spec: string;
  rate_paise: number;
  next_start: string | null;
}

/** End of the calendar day (UTC) containing `iso`, as an ISO string. */
function endOfDayUtc(iso: string): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)).toISOString();
}

/** Devices of a type free for [start,end); next_start = the device's next booked slot at/after `from`. */
async function freeDevices(
  tenantId: string,
  type: DeviceType,
  start: string,
  end: string,
  from: string,
  client: Db = pool,
): Promise<FreeRow[]> {
  const { rows } = await query<FreeRow>(
    `SELECT d.id, d.label, d.spec, d.rate_paise,
       (SELECT min(bd2.start_at) FROM booking_devices bd2
        WHERE bd2.device_id = d.id AND bd2.status IN ('upcoming','active') AND bd2.start_at >= $5) AS next_start
     FROM devices d
     WHERE d.tenant_id = $1 AND d.type = $2 AND d.status = 'available'
       AND NOT EXISTS (
         SELECT 1 FROM booking_devices bd
         WHERE bd.device_id = d.id AND bd.status IN ('upcoming','active')
           AND bd.slot && tstzrange($3, $4, '[)'))
     ORDER BY d.sort_order, d.label`,
    [tenantId, type, start, end, from],
    client,
  );
  return rows;
}

function toMatches(rows: FreeRow[], extendable: boolean, eod: string, duration: number): { matches: AvailabilityMatch[]; quote: (n: number) => number } {
  const matches: AvailabilityMatch[] = rows.map((r) => ({
    deviceId: r.id,
    label: r.label,
    spec: r.spec,
    ratePaise: r.rate_paise,
    availableTill: extendable ? (r.next_start ?? eod) : null,
  }));
  const quote = (guests: number) =>
    rows.slice(0, guests).reduce((sum, r) => sum + quotePaise(duration, r.rate_paise), 0);
  return { matches, quote };
}

export async function availabilityRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/availability/search', async (req): Promise<AvailabilitySearchRes> => {
    const { tenantId } = getAuth(req);
    const body = parse(SearchSchema, req.body);

    const start = new Date(body.startAt).toISOString();
    const end = new Date(new Date(start).getTime() + body.durationMinutes * 60_000).toISOString();
    const eod = endOfDayUtc(start);
    // Extendable holds the bay to end-of-day; that's the window we check for conflicts.
    const heldEnd = body.extendable ? eod : end;

    const rows = await freeDevices(tenantId, body.deviceType, start, heldEnd, start);
    const { matches, quote } = toMatches(rows, body.extendable, eod, body.durationMinutes);
    const ok = matches.length >= body.guests;

    const slot: AvailabilitySlot = {
      startAt: start,
      endAt: end,
      matches,
      quotePaise: quote(body.guests),
    };

    let nearest: AvailabilitySlot | null = null;
    if (!ok) {
      // Scan forward in 30-min steps (up to 12h) for the first window that seats everyone.
      for (let step = 1; step <= 24; step++) {
        const cs = new Date(new Date(start).getTime() + step * 30 * 60_000).toISOString();
        const ce = new Date(new Date(cs).getTime() + body.durationMinutes * 60_000).toISOString();
        const candEnd = body.extendable ? endOfDayUtc(cs) : ce;
        const cand = await freeDevices(tenantId, body.deviceType, cs, candEnd, cs);
        if (cand.length >= body.guests) {
          const m = toMatches(cand, body.extendable, endOfDayUtc(cs), body.durationMinutes);
          nearest = { startAt: cs, endAt: ce, matches: m.matches, quotePaise: m.quote(body.guests) };
          break;
        }
      }
    }

    return {
      ok,
      requested: {
        deviceType: body.deviceType,
        guests: body.guests,
        startAt: start,
        endAt: end,
        extendable: body.extendable,
      },
      slot,
      nearest,
    };
  });
}
