// Shared read helpers that assemble DTOs from rows.
import type { BookingDTO, BookingDeviceDTO, BookingStatus, DeviceType } from '@arenaze/shared';
import { pool, query, type Db } from '../db.js';

/** 'GG-8847' — next human booking code from the sequence. */
export async function nextBookingCode(client: Db = pool): Promise<string> {
  const { rows } = await query<{ code: string }>(
    `SELECT 'GG-' || nextval('booking_code_seq') AS code`,
    [],
    client,
  );
  return rows[0].code;
}

interface BookingRow {
  id: string;
  code: string;
  customer_id: string | null;
  customer_name: string | null;
  guests: number;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  extendable: boolean;
  total_paise: number;
  note: string | null;
  created_at: string;
}
interface BDRow {
  id: string;
  booking_id: string;
  device_id: string;
  label: string;
  type: DeviceType;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  rate_paise: number;
}

export interface LoadBookingsOpts {
  ids?: string[];
  from?: string;
  to?: string;
  status?: BookingStatus;
  customerId?: string;
  limit?: number;
}

/** Load bookings (with their devices + customer name) as BookingDTO[]. Newest first. */
export async function loadBookings(
  tenantId: string,
  opts: LoadBookingsOpts = {},
  client: Db = pool,
): Promise<BookingDTO[]> {
  const where: string[] = ['b.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  if (opts.ids) {
    params.push(opts.ids);
    where.push(`b.id = ANY($${params.length})`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`b.status = $${params.length}`);
  }
  if (opts.from) {
    params.push(opts.from);
    where.push(`b.start_at >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`b.start_at <= $${params.length}`);
  }
  if (opts.customerId) {
    params.push(opts.customerId);
    where.push(`b.customer_id = $${params.length}`);
  }
  const limitSql = opts.limit ? `LIMIT ${Math.trunc(opts.limit)}` : '';

  const { rows: brows } = await query<BookingRow>(
    `SELECT b.id, b.code, b.customer_id, c.name AS customer_name, b.guests,
            b.start_at, b.end_at, b.status, b.extendable, b.total_paise, b.note, b.created_at
     FROM bookings b
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE ${where.join(' AND ')}
     ORDER BY b.start_at DESC, b.created_at DESC ${limitSql}`,
    params,
    client,
  );
  if (brows.length === 0) return [];

  const bookingIds = brows.map((b) => b.id);
  const { rows: drows } = await query<BDRow>(
    `SELECT bd.id, bd.booking_id, bd.device_id, d.label, d.type,
            bd.start_at, bd.end_at, bd.status, bd.rate_paise
     FROM booking_devices bd
     JOIN devices d ON d.id = bd.device_id
     WHERE bd.booking_id = ANY($1)
     ORDER BY d.sort_order, d.label`,
    [bookingIds],
    client,
  );

  const byBooking = new Map<string, BookingDeviceDTO[]>();
  for (const d of drows) {
    const list = byBooking.get(d.booking_id) ?? [];
    list.push({
      id: d.id,
      deviceId: d.device_id,
      label: d.label,
      type: d.type,
      startAt: d.start_at,
      endAt: d.end_at,
      status: d.status,
      ratePaise: d.rate_paise,
    });
    byBooking.set(d.booking_id, list);
  }

  return brows.map((b) => ({
    id: b.id,
    code: b.code,
    customerId: b.customer_id,
    customerName: b.customer_name,
    guests: b.guests,
    startAt: b.start_at,
    endAt: b.end_at,
    status: b.status,
    extendable: b.extendable,
    totalPaise: b.total_paise,
    note: b.note,
    devices: byBooking.get(b.id) ?? [],
    createdAt: b.created_at,
  }));
}

/** Find a customer by id or contact number (handle as a legacy fallback), else
 * create one from the input. Returns id or null. */
export async function resolveCustomer(
  client: Db,
  tenantId: string,
  input: { id?: string; name?: string; handle?: string; phone?: string } | null | undefined,
): Promise<string | null> {
  if (!input) return null;
  if (input.id) return input.id;
  // Match an existing customer by contact number first, then by handle (legacy).
  if (input.phone && input.phone.trim()) {
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
      [tenantId, input.phone.trim()],
      client,
    );
    if (rows[0]) return rows[0].id;
  } else if (input.handle) {
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM customers WHERE tenant_id = $1 AND lower(handle) = lower($2) LIMIT 1`,
      [tenantId, input.handle],
      client,
    );
    if (rows[0]) return rows[0].id;
  }
  if (input.name || input.phone || input.handle) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO customers (tenant_id, name, handle, phone) VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, input.name ?? input.handle ?? 'Walk-in', input.handle ?? '', input.phone?.trim() || null],
      client,
    );
    return rows[0].id;
  }
  return null;
}
