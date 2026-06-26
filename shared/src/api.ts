// ============================================================================
// Arenaze API contract — the single source of truth shared by server + web.
//
// Conventions:
//  - All money is integer PAISE (see money.ts).
//  - All timestamps are ISO-8601 strings (UTC) over the wire.
//  - Auth: `Authorization: Bearer <accessToken>`. tenant_id is taken from the
//    token server-side and NEVER trusted from the client.
//  - Errors use the ApiErrorBody envelope below with the HTTP status noted.
// ============================================================================

import type {
  Role,
  DeviceType,
  DeviceLiveStatus,
  BookingStatus,
  CustomerTier,
} from './roles.js';

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------
export type ErrorCode =
  | 'unauthorized' // 401
  | 'forbidden' // 403 (role / tenant)
  | 'not_found' // 404
  | 'validation' // 400 (Zod)
  | 'conflict' // 409 (generic state)
  | 'slot_taken' // 409 (booking lost the race — "slot just taken")
  | 'invalid_transition' // 409 (illegal state-machine move)
  | 'idempotency_replay' // returned alongside the original 201 body when a key repeats
  | 'internal'; // 500

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Auth  —  POST /api/auth/login | /refresh | /logout | /forgot-password
// ---------------------------------------------------------------------------
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  tenantId: string;
  tenantName: string;
}

export interface LoginReq {
  username: string;
  password: string;
}
export interface LoginRes {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface RefreshReq {
  refreshToken: string;
}
export interface RefreshRes {
  accessToken: string;
  refreshToken: string; // rotated
}

export interface LogoutReq {
  refreshToken: string;
}

export interface ForgotPasswordReq {
  username: string;
}
export interface ForgotPasswordRes {
  ok: true; // always 200 to avoid user enumeration; demo logs a reset token
}

// ---------------------------------------------------------------------------
// Devices / Floor (Epic A)
//   GET   /api/devices                 -> DeviceSnapshot[]  (10s poll target)
//   POST  /api/devices/:id/start       -> StartSessionRes   (seat a single walk-in)
//   POST  /api/devices/:id/end-session -> EndSessionRes     (checkout, finalize bill)
//   POST  /api/devices/:id/extend      -> DeviceSnapshot    (push planned end out)
//   PATCH /api/devices/:id             -> DeviceSnapshot    (status: maintenance toggle, admin)
//   POST  /api/devices                 -> DeviceSnapshot    (create, admin)
// ---------------------------------------------------------------------------
export interface ActiveSession {
  id: string;
  playerLabel: string;
  customerId: string | null;
  startedAt: string;
  plannedEndAt: string | null;
  ratePaise: number;
  accruedPaise: number; // derived NOW on the server at read time
}

export interface DeviceReservationPeek {
  bookingId: string;
  code: string;
  customerName: string | null;
  startAt: string;
  endAt: string;
}

export interface DeviceSnapshot {
  id: string;
  label: string; // 'RIG-01'
  type: DeviceType;
  spec: string; // 'RTX 4070 · i7'
  ratePaise: number; // hourly
  status: DeviceLiveStatus; // available | active | reserved | maintenance (derived)
  session: ActiveSession | null; // present when status === 'active'
  reservation: DeviceReservationPeek | null; // next upcoming today when status === 'reserved'
}

export interface StartSessionReq {
  playerLabel: string;
  customerId?: string | null;
  durationMinutes: number;
}
export interface StartSessionRes {
  device: DeviceSnapshot;
  bookingId: string;
}

export interface EndSessionRes {
  deviceId: string;
  sessionId: string;
  chargedPaise: number;
  durationMinutes: number;
}

export interface ExtendDeviceReq {
  minutes: number; // e.g. 30
}

export interface PatchDeviceReq {
  status?: 'available' | 'maintenance';
  spec?: string;
  ratePaise?: number;
}

export interface CreateDeviceReq {
  label: string;
  type: DeviceType;
  spec: string;
  ratePaise: number;
}

// ---------------------------------------------------------------------------
// Dashboard  —  GET /api/dashboard/tiles
// ---------------------------------------------------------------------------
export interface DashboardTiles {
  occupancyRate: number; // 0..100 (active / capacity)
  activeCount: number;
  capacity: number; // devices not in maintenance
  freeCount: number;
  reservedCount: number; // upcoming reservations today
  revenueTodayPaise: number; // billed/finalized sessions today
}

// ---------------------------------------------------------------------------
// Availability (Epic B)  —  POST /api/availability/search
//   Returns the devices free for the requested slot; if not enough to seat
//   `guests`, returns the nearest later slot that can.
// ---------------------------------------------------------------------------
export interface AvailabilitySearchReq {
  deviceType: DeviceType;
  guests: number;
  startAt: string; // desired in-time, ISO
  durationMinutes: number;
  extendable: boolean; // hold the machine for the rest of the day
}

export interface AvailabilityMatch {
  deviceId: string;
  label: string;
  spec: string;
  ratePaise: number;
  availableTill: string | null; // for extendable: free until this time (next conflict / EOD)
}

export interface AvailabilitySlot {
  startAt: string;
  endAt: string;
  matches: AvailabilityMatch[];
  quotePaise: number; // guests × duration × rate
}

export interface AvailabilitySearchRes {
  ok: boolean; // true when >= guests devices are free for the requested slot
  requested: {
    deviceType: DeviceType;
    guests: number;
    startAt: string;
    endAt: string;
    extendable: boolean;
  };
  slot: AvailabilitySlot; // matches for the REQUESTED window (may be < guests)
  nearest: AvailabilitySlot | null; // populated when !ok: nearest later window that seats guests
}

// ---------------------------------------------------------------------------
// Bookings (Epic C)
//   POST /api/bookings           (Idempotency-Key header; serializable txn)
//        -> 201 BookingDTO   |   409 { error.code:'slot_taken' }
//   POST /api/bookings/:id/start  -> BookingDTO  (check-in: upcoming -> active, opens sessions)
//   POST /api/bookings/:id/extend -> BookingDTO
//   POST /api/bookings/:id/cancel -> BookingDTO
//   GET  /api/bookings?from&to&status   (Epic D — the ledger)  -> BookingDTO[]
// ---------------------------------------------------------------------------
export interface BookingCustomerInput {
  id?: string; // existing customer
  name?: string; // or capture a new walk-in
  handle?: string;
  phone?: string;
}

export interface BookingCreateReq {
  deviceType: DeviceType;
  guests: number;
  startAt: string; // ISO. If <= now, the booking is created already-active (walk-in).
  durationMinutes: number;
  extendable: boolean;
  customer: BookingCustomerInput | null;
  note?: string;
  deviceIds?: string[]; // optional explicit pick; otherwise the engine auto-assigns free bays
}

export interface BookingDeviceDTO {
  id: string;
  deviceId: string;
  label: string;
  type: DeviceType;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  ratePaise: number;
}

export interface BookingDTO {
  id: string;
  code: string; // 'GG-8841'
  customerId: string | null;
  customerName: string | null;
  guests: number;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  extendable: boolean;
  totalPaise: number;
  note: string | null;
  devices: BookingDeviceDTO[];
  createdAt: string;
}

export interface BookingExtendReq {
  minutes: number;
}

export interface LedgerQuery {
  from?: string; // ISO date (inclusive)
  to?: string; // ISO date (inclusive)
  status?: BookingStatus;
}

// ---------------------------------------------------------------------------
// Customers  —  GET /api/customers?q   |   GET /api/customers/:id
// ---------------------------------------------------------------------------
export interface CustomerDTO {
  id: string;
  name: string;
  handle: string;
  phone: string | null;
  tier: CustomerTier;
  hours: number; // derived lifetime play hours
  spendPaise: number; // derived lifetime spend
  visits: number; // derived booking count
  lastSeen: string | null; // ISO of most recent activity, or null
}

export interface CustomerDetail extends CustomerDTO {
  bookings: BookingDTO[];
}

// ---------------------------------------------------------------------------
// Pricing (admin only)
//   GET   /api/pricing            -> PricingRuleDTO[]
//   PATCH /api/pricing/:id        -> PricingRuleDTO  (updates rate; cascades to devices of that type)
// ---------------------------------------------------------------------------
export interface PricingRuleDTO {
  id: string;
  deviceType: DeviceType;
  ratePaise: number; // hourly
  updatedAt: string;
}

export interface PricingUpdateReq {
  ratePaise: number;
}

// ---------------------------------------------------------------------------
// Analytics (admin only)  —  GET /api/analytics/overview
// ---------------------------------------------------------------------------
export interface AnalyticsOverview {
  utilByHour: { hour: string; value: number }[]; // value = % utilization
  revenueByDay: { day: string; valuePaise: number }[];
  metrics: {
    utilizationNow: number; // %
    revenueTodayPaise: number;
    sessionsToday: number;
    avgSessionMinutes: number;
    avgTicketPaise: number;
  };
}
