// ============================================================================
// Arenaze typed API client.
//  - base = VITE_API_BASE (falls back to same-origin, which Vite proxies to :4000)
//  - attaches `Authorization: Bearer <access>` from localStorage
//  - parses ApiErrorBody -> throws a typed `ApiError` (.code, .status)
//  - silent refresh: on a 401 from a non-auth route, calls /api/auth/refresh once
//    with the stored refresh token, persists the rotated pair, and retries. On
//    refresh failure it clears tokens and fires the logout signal (AuthContext
//    subscribes to this).
// ============================================================================
import type {
  ApiErrorBody,
  ErrorCode,
  LoginReq,
  LoginRes,
  RefreshReq,
  RefreshRes,
  LogoutReq,
  ForgotPasswordReq,
  ForgotPasswordRes,
  DeviceSnapshot,
  StartSessionReq,
  StartSessionRes,
  EndSessionRes,
  ExtendDeviceReq,
  PatchDeviceReq,
  CreateDeviceReq,
  DashboardTiles,
  AvailabilitySearchReq,
  AvailabilitySearchRes,
  BookingCreateReq,
  BookingDTO,
  BookingExtendReq,
  LedgerQuery,
  CustomerDTO,
  CustomerDetail,
  PricingRuleDTO,
  PricingUpdateReq,
  AnalyticsOverview,
  InvoiceQuery,
  InvoiceListRes,
  InvoiceDetail,
  InvoiceDTO,
  InvoiceStatusUpdateReq,
} from '@arenaze/shared';

// `import.meta.env.VITE_API_BASE` -> e.g. http://localhost:4000. Empty string
// means "same origin", which the Vite dev proxy forwards to the Fastify server.
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

// ---------------------------------------------------------------------------
// Token storage (localStorage is the single source of truth for tokens).
// ---------------------------------------------------------------------------
const ACCESS_KEY = 'arenaze.accessToken';
const REFRESH_KEY = 'arenaze.refreshToken';

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}
export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// ---------------------------------------------------------------------------
// Logout signal — the client fires this when a silent refresh fails so the
// AuthContext can tear down the session and bounce to /login.
// ---------------------------------------------------------------------------
type LogoutListener = () => void;
const logoutListeners = new Set<LogoutListener>();

/** Subscribe to forced-logout events. Returns an unsubscribe fn. */
export function onForcedLogout(cb: LogoutListener): () => void {
  logoutListeners.add(cb);
  return () => logoutListeners.delete(cb);
}
function signalLogout(): void {
  clearTokens();
  logoutListeners.forEach((cb) => cb());
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(status: number, body: ApiErrorBody | null, fallback?: string) {
    super(body?.error?.message ?? fallback ?? `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? (status === 401 ? 'unauthorized' : 'internal');
    this.details = body?.error?.details;
  }
}

// ---------------------------------------------------------------------------
// Silent refresh (deduped across concurrent 401s)
// ---------------------------------------------------------------------------
let refreshInFlight: Promise<boolean> | null = null;

function trySilentRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(API_BASE + '/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken } satisfies RefreshReq),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as RefreshRes;
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------
interface RequestOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Attach the bearer token (default true). */
  auth?: boolean;
  /** Allow one silent-refresh retry on 401 (default true). Internal. */
  retry?: boolean;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, auth = true, retry = true } = opts;

  const finalHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  if (auth) {
    const token = getAccessToken();
    if (token) finalHeaders['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(API_BASE + path, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Silent refresh on 401 for protected, non-auth routes (once).
  if (res.status === 401 && auth && retry && !path.startsWith('/api/auth/')) {
    const refreshed = await trySilentRefresh();
    if (refreshed) return request<T>(path, { ...opts, retry: false });
    signalLogout();
  }

  if (!res.ok) {
    let parsed: ApiErrorBody | null = null;
    try {
      parsed = (await res.json()) as ApiErrorBody;
    } catch {
      // non-JSON error body — keep parsed null
    }
    throw new ApiError(res.status, parsed);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ============================================================================
// Endpoint functions (one per API row in BUILD_CONTRACT.md)
// ============================================================================

// ---- Auth ----
export const login = (req: LoginReq) =>
  request<LoginRes>('/api/auth/login', { method: 'POST', body: req, auth: false });

export const refresh = (req: RefreshReq) =>
  request<RefreshRes>('/api/auth/refresh', { method: 'POST', body: req, auth: false });

export const logout = (req: LogoutReq) =>
  request<{ ok: true }>('/api/auth/logout', { method: 'POST', body: req, auth: true, retry: false });

export const forgotPassword = (req: ForgotPasswordReq) =>
  request<ForgotPasswordRes>('/api/auth/forgot-password', { method: 'POST', body: req, auth: false });

// ---- Devices / Floor ----
export const getDevices = () => request<DeviceSnapshot[]>('/api/devices');

export const startDevice = (id: string, req: StartSessionReq) =>
  request<StartSessionRes>(`/api/devices/${id}/start`, { method: 'POST', body: req });

export const endSession = (id: string) =>
  request<EndSessionRes>(`/api/devices/${id}/end-session`, { method: 'POST' });

export const extendDevice = (id: string, req: ExtendDeviceReq) =>
  request<DeviceSnapshot>(`/api/devices/${id}/extend`, { method: 'POST', body: req });

export const patchDevice = (id: string, req: PatchDeviceReq) =>
  request<DeviceSnapshot>(`/api/devices/${id}`, { method: 'PATCH', body: req });

export const createDevice = (req: CreateDeviceReq) =>
  request<DeviceSnapshot>('/api/devices', { method: 'POST', body: req });

export const deleteDevice = (id: string) =>
  request<{ ok: true }>(`/api/devices/${id}`, { method: 'DELETE' });

// ---- Dashboard ----
export const getDashboardTiles = () => request<DashboardTiles>('/api/dashboard/tiles');

// ---- Availability ----
export const searchAvailability = (req: AvailabilitySearchReq) =>
  request<AvailabilitySearchRes>('/api/availability/search', { method: 'POST', body: req });

// ---- Bookings ----
export const createBooking = (req: BookingCreateReq) =>
  request<BookingDTO>('/api/bookings', {
    method: 'POST',
    body: req,
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });

export const startBooking = (id: string) =>
  request<BookingDTO>(`/api/bookings/${id}/start`, { method: 'POST' });

export const extendBooking = (id: string, req: BookingExtendReq) =>
  request<BookingDTO>(`/api/bookings/${id}/extend`, { method: 'POST', body: req });

export const cancelBooking = (id: string) =>
  request<BookingDTO>(`/api/bookings/${id}/cancel`, { method: 'POST' });

export const listBookings = (query: LedgerQuery = {}) =>
  request<BookingDTO[]>(`/api/bookings${qs({ from: query.from, to: query.to, status: query.status })}`);

// ---- Customers ----
export const listCustomers = (q?: string) =>
  request<CustomerDTO[]>(`/api/customers${qs({ q })}`);

export const getCustomer = (id: string) => request<CustomerDetail>(`/api/customers/${id}`);

// ---- Pricing (admin) ----
export const listPricing = () => request<PricingRuleDTO[]>('/api/pricing');

export const updatePricing = (id: string, req: PricingUpdateReq) =>
  request<PricingRuleDTO>(`/api/pricing/${id}`, { method: 'PATCH', body: req });

// ---- Analytics (admin) ----
export const getAnalyticsOverview = () => request<AnalyticsOverview>('/api/analytics/overview');

// ---- Account Ledger / Invoices (admin) ----
export const listInvoices = (q: InvoiceQuery = {}) =>
  request<InvoiceListRes>(
    `/api/analytics/invoices${qs({ period: q.period, from: q.from, to: q.to, status: q.status, method: q.method, q: q.q })}`,
  );

export const getInvoice = (id: string) => request<InvoiceDetail>(`/api/analytics/invoices/${id}`);

export const updateInvoiceStatus = (id: string, req: InvoiceStatusUpdateReq) =>
  request<InvoiceDTO>(`/api/analytics/invoices/${id}`, { method: 'PATCH', body: req });
