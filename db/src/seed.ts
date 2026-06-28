// Idempotent demo seed for Arenaze. Re-runnable: truncates domain tables and
// resets the booking-code sequence, then ports _design_ref/gg-data.js into real
// rows so the floor looks alive (active sessions + accrued tabs), the calendar
// has upcoming reservations, and "revenue today" / analytics are non-zero.
//
// All money is INTEGER PAISE. The booking_devices.slot column is GENERATED — never
// inserted. Every upcoming/active booking_device slot is pre-checked in memory so
// the no_double_book GiST exclusion constraint is never tripped.
import pg from 'pg';
import { hash, type Algorithm } from '@node-rs/argon2';
import { accruedPaise, quotePaise, rupeesToPaise } from '@arenaze/shared';
import { ENV_PATH, requireDatabaseUrl } from './env.js';

const databaseUrl = requireDatabaseUrl();

// Algorithm.Argon2id === 2. Type-only import + cast avoids isolatedModules'
// "ambient const enum" error while keeping the algorithm explicit.
const ARGON_OPTS = { algorithm: 2 as Algorithm } as const;

// ---------------------------------------------------------------------------
// Device floor — replicates gg-data.js mk() EXACTLY (order + player rotation).
// ---------------------------------------------------------------------------
type LiveState = 'active' | 'free' | 'maint';
interface DeviceSeed {
  id: string; // filled after insert
  label: string;
  type: 'PC' | 'PS5' | 'Xbox' | 'VR';
  spec: string;
  ratePaise: number;
  status: 'available' | 'maintenance';
  sortOrder: number;
  live: LiveState;
  player: string | null;
  elapsedMin: number;
  leftMin: number;
}

const PLAYERS = [
  'Kabir_M', 'Riya.GG', 'Aces_Veer', 'NovaZ', 'Tanish', 'Devashish', 'ShadowOps',
  'Meera_K', 'RaptorX', 'Yug_99', 'Slayer_07', 'Anika.P', 'Vortex', 'KiloByte',
  'Pixel_Rai', 'GhostIN',
];

function buildDevices(): DeviceSeed[] {
  const devices: DeviceSeed[] = [];
  let p = 0;
  let sortOrder = 0;

  const mk = (
    label: string,
    type: DeviceSeed['type'],
    spec: string,
    rateRupees: number,
    state: LiveState,
    elapsedMin: number,
    leftMin: number,
  ): void => {
    const active = state === 'active';
    devices.push({
      id: '',
      label,
      type,
      spec,
      ratePaise: rupeesToPaise(rateRupees),
      status: state === 'maint' ? 'maintenance' : 'available',
      sortOrder: sortOrder++,
      live: state,
      player: active ? PLAYERS[p++ % PLAYERS.length] : null,
      elapsedMin: active ? elapsedMin : 0,
      leftMin: active ? leftMin : 0,
    });
  };

  // 16 PC rigs (RIG-01..RIG-16)
  const pcSpecs = ['RTX 4070 · i7', 'RTX 4070 · i7', 'RTX 4060 · i5', 'RTX 4060 · i5'];
  for (let i = 1; i <= 16; i++) {
    const label = 'RIG-' + String(i).padStart(2, '0');
    const spec = pcSpecs[i % pcSpecs.length];
    const rate = spec.includes('4070') ? 220 : 160;
    let state: LiveState = 'free';
    let elapsed = 0;
    let left = 0;
    if (i <= 11) {
      state = 'active';
      elapsed = 10 + i * 3;
      left = 12 + ((i * 7) % 90);
    } else if (i === 14) {
      state = 'maint';
    }
    mk(label, 'PC', spec, rate, state, elapsed, left);
  }
  // 4 PS5 (PS5-1..4) — first two active
  for (let i = 1; i <= 4; i++) {
    const state: LiveState = i <= 2 ? 'active' : 'free';
    mk('PS5-' + i, 'PS5', 'PlayStation 5', 200, state, 20 + i * 5, 30 + i * 8);
  }
  // 2 Xbox
  mk('XBX-1', 'Xbox', 'Series X', 200, 'active', 35, 25);
  mk('XBX-2', 'Xbox', 'Series X', 200, 'free', 0, 0);
  // 2 VR
  mk('VR-1', 'VR', 'Meta Quest 3', 300, 'active', 12, 18);
  mk('VR-2', 'VR', 'Valve Index', 300, 'free', 0, 0);

  return devices;
}

// ---------------------------------------------------------------------------
// CRM members (ported) + the catalog of reservations.
// ---------------------------------------------------------------------------
interface MemberSeed { name: string; handle: string; phone: string; tier: 'Casual' | 'Pro' | 'Elite'; }
const MEMBERS: MemberSeed[] = [
  { name: 'Kabir Malhotra', handle: 'Kabir_M', phone: '98201 44552', tier: 'Elite' },
  { name: 'Riya Sharma', handle: 'Riya.GG', phone: '99301 27845', tier: 'Pro' },
  { name: 'Veer Anand', handle: 'Aces_Veer', phone: '90043 11892', tier: 'Elite' },
  { name: 'Meera Kapoor', handle: 'Meera_K', phone: '88282 67310', tier: 'Pro' },
  { name: 'Tanish Roy', handle: 'Tanish', phone: '70459 98123', tier: 'Casual' },
  { name: 'Yug Patel', handle: 'Yug_99', phone: '63597 44021', tier: 'Pro' },
];

interface ReservationSeed {
  code: string;
  player: string;
  platform: DeviceSeed['type'];
  qty: number;
  slot: string;
  amount: number; // rupees
  note: string;
}
// Codes preserved from the design seed (GG-8841..GG-8846); booking_code_seq starts
// at 8847 and "continues GG-8846", so new active/completed bookings draw from it.
const RESERVATIONS: ReservationSeed[] = [
  { code: 'GG-8841', player: 'Kabir_M', platform: 'PC', qty: 5, slot: '19:00 – 22:00', amount: 3300, note: 'Squad · adjacent' },
  { code: 'GG-8842', player: 'NovaZ', platform: 'PS5', qty: 2, slot: '20:30 – 22:30', amount: 800, note: 'FIFA night' },
  { code: 'GG-8843', player: 'Meera_K', platform: 'VR', qty: 1, slot: '21:00 – 21:45', amount: 225, note: 'Beat Saber' },
  { code: 'GG-8844', player: 'Aces_Veer', platform: 'PC', qty: 8, slot: '22:00 – 01:00', amount: 5280, note: 'Valorant scrim' },
  { code: 'GG-8845', player: 'Tanish', platform: 'Xbox', qty: 1, slot: '18:30 – 20:00', amount: 300, note: '' },
  { code: 'GG-8846', player: 'RaptorX', platform: 'PC', qty: 3, slot: '23:00 – 02:00', amount: 1980, note: 'Late grind' },
];

// ---------------------------------------------------------------------------
// Completed sessions today (revenue + analytics). Anchored to end before `now`.
// ---------------------------------------------------------------------------
interface CompletedSeed { label: string; handle: string | null; durationMin: number; endOffsetMin: number; }
const COMPLETED: CompletedSeed[] = [
  { label: 'RIG-01', handle: 'Kabir_M', durationMin: 180, endOffsetMin: 30 },
  { label: 'RIG-03', handle: 'Riya.GG', durationMin: 150, endOffsetMin: 55 },
  { label: 'PS5-3', handle: 'NovaZ', durationMin: 90, endOffsetMin: 80 },
  { label: 'PS5-4', handle: 'Tanish', durationMin: 120, endOffsetMin: 120 },
  { label: 'XBX-2', handle: null, durationMin: 75, endOffsetMin: 150 },
  { label: 'VR-2', handle: 'Meera_K', durationMin: 60, endOffsetMin: 175 },
  { label: 'RIG-05', handle: 'Aces_Veer', durationMin: 240, endOffsetMin: 200 },
  { label: 'RIG-08', handle: null, durationMin: 150, endOffsetMin: 240 },
];

// ---------------------------------------------------------------------------
// Slot helpers — parse "HH:MM – HH:MM" relative to today; in-memory overlap guard.
// ---------------------------------------------------------------------------
function parseSlot(slot: string, ref: Date): { start: Date; end: Date } {
  const parts = slot.split(/\s*[–—-]\s*/).map((s) => s.trim());
  const [sh, sm] = parts[0].split(':').map(Number);
  const [eh, em] = parts[1].split(':').map(Number);
  const start = new Date(ref);
  start.setHours(sh, sm, 0, 0);
  const end = new Date(ref);
  end.setHours(eh, em, 0, 0);
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1); // crosses midnight
  // Shift to the next future occurrence if the slot already started.
  while (start.getTime() <= ref.getTime()) {
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 1);
  }
  return { start, end };
}

class SlotBook {
  private byDevice = new Map<string, Array<{ start: number; end: number }>>();
  record(deviceId: string, start: Date, end: Date): void {
    const arr = this.byDevice.get(deviceId) ?? [];
    arr.push({ start: start.getTime(), end: end.getTime() });
    this.byDevice.set(deviceId, arr);
  }
  overlaps(deviceId: string, start: Date, end: Date): boolean {
    const arr = this.byDevice.get(deviceId);
    if (!arr) return false;
    const s = start.getTime();
    const e = end.getTime();
    return arr.some((r) => s < r.end && r.start < e); // half-open [start,end)
  }
}

const rupees = (paise: number): string => '₹' + Math.round(paise / 100).toLocaleString('en-IN');

// Deterministic 10-digit Indian mobile (first digit 6–9), formatted "XXXXX XXXXX".
// Used to give auto-created player/reservation customers a contact number so the
// Customers screen's Contact column is populated in the demo. The large, jagged
// multiplier scatters the digits so consecutive numbers don't share a prefix.
function genPhone(seq: number): string {
  const n = 6_000_000_000 + ((seq + 1) * 386_792_311) % 3_900_000_000;
  const s = String(n);
  return s.slice(0, 5) + ' ' + s.slice(5);
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`[seed] env: ${ENV_PATH}`);

  const adminUser = process.env.SEED_ADMIN_USERNAME || 'admin';
  const adminPass = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const staffUser = process.env.SEED_STAFF_USERNAME || 'staff';
  const staffPass = process.env.SEED_STAFF_PASSWORD || 'staff123';

  const [adminHash, staffHash] = await Promise.all([
    hash(adminPass, ARGON_OPTS),
    hash(staffPass, ARGON_OPTS),
  ]);

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const slots = new SlotBook();

  try {
    await client.query('BEGIN');

    // -- Clear domain tables (re-runnable) + reset booking code sequence ------
    await client.query(`
      TRUNCATE tenants, users, refresh_tokens, devices, customers, pricing_rules,
               bookings, booking_devices, sessions, transactions, audit_log
      RESTART IDENTITY CASCADE
    `);
    await client.query(`SELECT setval('booking_code_seq', 8847, false)`);

    const nextCode = async (): Promise<string> => {
      const { rows } = await client.query<{ code: string }>(
        `SELECT 'GG-' || nextval('booking_code_seq') AS code`,
      );
      return rows[0].code;
    };

    // -- tenant ----------------------------------------------------------------
    const tenantRes = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, area, code) VALUES ($1,$2,$3) RETURNING id`,
      ['Nexus LAN', 'Andheri West, Mumbai', 'NXS-001'],
    );
    const tenantId = tenantRes.rows[0].id;

    // -- users (argon2id) ------------------------------------------------------
    const adminRes = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, username, password_hash, display_name, role)
       VALUES ($1,$2,$3,$4,'admin') RETURNING id`,
      [tenantId, adminUser, adminHash, 'Admin'],
    );
    const adminId = adminRes.rows[0].id;
    await client.query(
      `INSERT INTO users (tenant_id, username, password_hash, display_name, role)
       VALUES ($1,$2,$3,$4,'staff')`,
      [tenantId, staffUser, staffHash, 'Staff'],
    );

    // -- devices ---------------------------------------------------------------
    const devices = buildDevices();
    const deviceByLabel = new Map<string, DeviceSeed>();
    for (const d of devices) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO devices (tenant_id, label, type, spec, rate_paise, status, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tenantId, d.label, d.type, d.spec, d.ratePaise, d.status, d.sortOrder],
      );
      d.id = res.rows[0].id;
      deviceByLabel.set(d.label, d);
    }

    // -- pricing_rules (one hourly rate per type) ------------------------------
    const pricing: Array<[DeviceSeed['type'], number]> = [
      ['PC', 220], ['PS5', 200], ['Xbox', 200], ['VR', 300],
    ];
    for (const [type, r] of pricing) {
      await client.query(
        `INSERT INTO pricing_rules (tenant_id, device_type, rate_paise) VALUES ($1,$2,$3)`,
        [tenantId, type, rupeesToPaise(r)],
      );
    }

    // -- customers (members + any active/reservation handle not present) -------
    const customerByHandle = new Map<string, string>();
    for (const m of MEMBERS) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO customers (tenant_id, name, handle, phone, tier)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tenantId, m.name, m.handle, m.phone, m.tier],
      );
      customerByHandle.set(m.handle, res.rows[0].id);
    }
    const neededHandles: string[] = [];
    for (const d of devices) if (d.player) neededHandles.push(d.player);
    for (const r of RESERVATIONS) neededHandles.push(r.player);
    let phoneSeq = 0;
    for (const handle of neededHandles) {
      if (customerByHandle.has(handle)) continue;
      const res = await client.query<{ id: string }>(
        `INSERT INTO customers (tenant_id, name, handle, phone, tier)
         VALUES ($1,$2,$3,$4,'Casual') RETURNING id`,
        [tenantId, handle, handle, genPhone(phoneSeq++)],
      );
      customerByHandle.set(handle, res.rows[0].id);
    }

    // -- ACTIVE sessions (one booking + booking_device + session per device) ---
    let activeCount = 0;
    for (const d of devices) {
      if (d.live !== 'active') continue;
      const start = new Date(now.getTime() - d.elapsedMin * 60_000);
      const end = new Date(now.getTime() + d.leftMin * 60_000);
      const code = await nextCode();
      const customerId = d.player ? customerByHandle.get(d.player) ?? null : null;
      const total = quotePaise(d.elapsedMin + d.leftMin, d.ratePaise);

      const booking = await client.query<{ id: string }>(
        `INSERT INTO bookings
           (tenant_id, code, customer_id, guests, start_at, end_at, status, extendable, total_paise, created_by)
         VALUES ($1,$2,$3,1,$4,$5,'active',true,$6,$7) RETURNING id`,
        [tenantId, code, customerId, start, end, total, adminId],
      );
      const bookingId = booking.rows[0].id;

      const bd = await client.query<{ id: string }>(
        `INSERT INTO booking_devices
           (tenant_id, booking_id, device_id, start_at, end_at, status, rate_paise)
         VALUES ($1,$2,$3,$4,$5,'active',$6) RETURNING id`,
        [tenantId, bookingId, d.id, start, end, d.ratePaise],
      );
      slots.record(d.id, start, end);

      await client.query(
        `INSERT INTO sessions
           (tenant_id, device_id, booking_id, booking_device_id, customer_id, player_label,
            rate_paise, started_at, planned_end_at, ended_at, accrued_paise)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL)`,
        [tenantId, d.id, bookingId, bd.rows[0].id, customerId, d.player ?? 'Walk-in', d.ratePaise, start, end],
      );
      activeCount += 1;
    }

    // -- UPCOMING reservations -------------------------------------------------
    let upcomingBookings = 0;
    let upcomingDevices = 0;
    for (const r of RESERVATIONS) {
      const { start, end } = parseSlot(r.slot, now);
      const candidates = devices.filter(
        (d) => d.type === r.platform && d.status !== 'maintenance' && !slots.overlaps(d.id, start, end),
      );
      const chosen = candidates.slice(0, r.qty);
      if (chosen.length < r.qty) {
        console.warn(
          `[seed] reservation ${r.code}: only ${chosen.length}/${r.qty} ${r.platform} device(s) free for ${r.slot} — reducing.`,
        );
      }
      if (chosen.length === 0) {
        console.warn(`[seed] reservation ${r.code}: no free ${r.platform} devices — skipping booking.`);
        continue;
      }
      const customerId = customerByHandle.get(r.player) ?? null;
      const booking = await client.query<{ id: string }>(
        `INSERT INTO bookings
           (tenant_id, code, customer_id, guests, start_at, end_at, status, extendable, total_paise, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'upcoming',true,$7,$8,$9) RETURNING id`,
        [tenantId, r.code, customerId, chosen.length, start, end, r.amount * 100, r.note || null, adminId],
      );
      const bookingId = booking.rows[0].id;
      upcomingBookings += 1;
      for (const d of chosen) {
        await client.query(
          `INSERT INTO booking_devices
             (tenant_id, booking_id, device_id, start_at, end_at, status, rate_paise)
           VALUES ($1,$2,$3,$4,$5,'upcoming',$6)`,
          [tenantId, bookingId, d.id, start, end, d.ratePaise],
        );
        slots.record(d.id, start, end);
        upcomingDevices += 1;
      }
    }

    // -- COMPLETED sessions today (+ transactions = revenue today) -------------
    let completedCount = 0;
    let revenueToday = 0;
    for (const c of COMPLETED) {
      const d = deviceByLabel.get(c.label);
      if (!d) {
        console.warn(`[seed] completed: unknown device ${c.label} — skipping.`);
        continue;
      }
      const ended = new Date(now.getTime() - c.endOffsetMin * 60_000);
      let started = new Date(ended.getTime() - c.durationMin * 60_000);
      if (started.getTime() < startOfToday.getTime()) {
        started = new Date(startOfToday.getTime() + 60_000); // keep it within today
      }
      const durationSec = Math.round((ended.getTime() - started.getTime()) / 1000);
      const accrued = accruedPaise(durationSec, d.ratePaise);
      const customerId = c.handle ? customerByHandle.get(c.handle) ?? null : null;
      const code = await nextCode();

      const booking = await client.query<{ id: string }>(
        `INSERT INTO bookings
           (tenant_id, code, customer_id, guests, start_at, end_at, status, total_paise, created_by, created_at)
         VALUES ($1,$2,$3,1,$4,$5,'completed',$6,$7,$8) RETURNING id`,
        [tenantId, code, customerId, started, ended, accrued, adminId, ended],
      );
      const bookingId = booking.rows[0].id;

      const bd = await client.query<{ id: string }>(
        `INSERT INTO booking_devices
           (tenant_id, booking_id, device_id, start_at, end_at, status, rate_paise)
         VALUES ($1,$2,$3,$4,$5,'completed',$6) RETURNING id`,
        [tenantId, bookingId, d.id, started, ended, d.ratePaise],
      );

      const session = await client.query<{ id: string }>(
        `INSERT INTO sessions
           (tenant_id, device_id, booking_id, booking_device_id, customer_id, player_label,
            rate_paise, started_at, planned_end_at, ended_at, accrued_paise, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$8) RETURNING id`,
        [tenantId, d.id, bookingId, bd.rows[0].id, customerId, c.handle ?? 'Walk-in', d.ratePaise, started, ended, accrued],
      );

      await client.query(
        `INSERT INTO transactions
           (tenant_id, booking_id, session_id, customer_id, device_id, kind, amount_paise, note, created_at)
         VALUES ($1,$2,$3,$4,$5,'session',$6,$7,$8)`,
        [tenantId, bookingId, session.rows[0].id, customerId, d.id, accrued, 'Session checkout', ended],
      );
      completedCount += 1;
      revenueToday += accrued;
    }

    await client.query('COMMIT');

    // -- Summary ---------------------------------------------------------------
    const counts = await client.query<Record<string, string>>(`
      SELECT
        (SELECT count(*) FROM tenants)         AS tenants,
        (SELECT count(*) FROM users)           AS users,
        (SELECT count(*) FROM devices)         AS devices,
        (SELECT count(*) FROM customers)       AS customers,
        (SELECT count(*) FROM pricing_rules)   AS pricing_rules,
        (SELECT count(*) FROM bookings)        AS bookings,
        (SELECT count(*) FROM booking_devices) AS booking_devices,
        (SELECT count(*) FROM sessions)        AS sessions,
        (SELECT count(*) FROM sessions WHERE ended_at IS NULL) AS active_sessions,
        (SELECT count(*) FROM transactions)    AS transactions,
        (SELECT count(*) FROM bookings WHERE status = 'upcoming') AS upcoming_bookings
    `);
    const dbRevenue = await client.query<{ sum: string | null }>(
      `SELECT COALESCE(sum(amount_paise),0)::text AS sum
         FROM transactions WHERE created_at::date = current_date`,
    );

    const c = counts.rows[0];
    console.log('\n[seed] ✓ done. Table counts:');
    for (const k of Object.keys(c)) console.log(`         ${k.padEnd(18)} ${c[k]}`);
    console.log(`\n[seed] active sessions (ended_at IS NULL): ${activeCount}`);
    console.log(`[seed] upcoming bookings: ${upcomingBookings}  (booking_devices: ${upcomingDevices})`);
    console.log(`[seed] completed sessions today: ${completedCount}`);
    console.log(`[seed] revenue today (computed): ${rupees(revenueToday)} (${revenueToday} paise)`);
    console.log(`[seed] revenue today (db sum):   ${rupees(Number(dbRevenue.rows[0].sum))} (${dbRevenue.rows[0].sum} paise)`);
    console.log('\n[seed] demo logins:');
    console.log(`         admin -> ${adminUser} / ${adminPass}`);
    console.log(`         staff -> ${staffUser} / ${staffPass}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[seed] ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
