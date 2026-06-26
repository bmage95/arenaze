// ============================================================================
// TanStack Query hooks for Arenaze. The QueryClient is created in main.tsx.
//  - Floor data (devices + dashboard tiles) polls every 10s per the PRD.
//  - Every mutation invalidates the floor (['devices'] + ['dashboardTiles'])
//    plus any relevant list, so a successful action forces a fresh snapshot.
// ============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LedgerQuery,
  StartSessionReq,
  ExtendDeviceReq,
  PatchDeviceReq,
  CreateDeviceReq,
  BookingCreateReq,
  BookingExtendReq,
  PricingUpdateReq,
} from '@arenaze/shared';
import * as api from './client';

// ---------------------------------------------------------------------------
// Query keys (exported so views/tests can reference + invalidate them)
// ---------------------------------------------------------------------------
export const queryKeys = {
  devices: ['devices'] as const,
  dashboardTiles: ['dashboardTiles'] as const,
  bookings: (filters: LedgerQuery = {}) => ['bookings', filters] as const,
  bookingsAll: ['bookings'] as const,
  customers: (q = '') => ['customers', q] as const,
  customersAll: ['customers'] as const,
  customer: (id: string) => ['customer', id] as const,
  pricing: ['pricing'] as const,
  analyticsOverview: ['analyticsOverview'] as const,
};

const POLL_MS = 10_000;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export function useDevices() {
  return useQuery({
    queryKey: queryKeys.devices,
    queryFn: api.getDevices,
    refetchInterval: POLL_MS,
  });
}

export function useDashboardTiles() {
  return useQuery({
    queryKey: queryKeys.dashboardTiles,
    queryFn: api.getDashboardTiles,
    refetchInterval: POLL_MS,
  });
}

export function useBookings(filters: LedgerQuery = {}) {
  return useQuery({
    queryKey: queryKeys.bookings(filters),
    queryFn: () => api.listBookings(filters),
  });
}

export function useCustomers(q?: string) {
  return useQuery({
    queryKey: queryKeys.customers(q ?? ''),
    queryFn: () => api.listCustomers(q),
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: queryKeys.customer(id),
    queryFn: () => api.getCustomer(id),
    enabled: !!id,
  });
}

export function usePricing() {
  return useQuery({
    queryKey: queryKeys.pricing,
    queryFn: api.listPricing,
  });
}

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: queryKeys.analyticsOverview,
    queryFn: api.getAnalyticsOverview,
  });
}

// ---------------------------------------------------------------------------
// Mutations — `useFloorInvalidate` refreshes the live floor after any action.
// ---------------------------------------------------------------------------
function useInvalidator() {
  const qc = useQueryClient();
  return (extra: readonly (readonly unknown[])[] = []) => {
    qc.invalidateQueries({ queryKey: queryKeys.devices });
    qc.invalidateQueries({ queryKey: queryKeys.dashboardTiles });
    for (const key of extra) qc.invalidateQueries({ queryKey: key });
  };
}

export function useStartDevice() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (v: { id: string; req: StartSessionReq }) => api.startDevice(v.id, v.req),
    onSuccess: () => invalidate([queryKeys.bookingsAll, queryKeys.customersAll]),
  });
}

export function useEndSession() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (id: string) => api.endSession(id),
    onSuccess: () => invalidate([queryKeys.bookingsAll, queryKeys.customersAll, queryKeys.analyticsOverview]),
  });
}

export function useExtendDevice() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (v: { id: string; req: ExtendDeviceReq }) => api.extendDevice(v.id, v.req),
    onSuccess: () => invalidate([queryKeys.bookingsAll]),
  });
}

export function usePatchDevice() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (v: { id: string; req: PatchDeviceReq }) => api.patchDevice(v.id, v.req),
    onSuccess: () => invalidate(),
  });
}

export function useCreateDevice() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (req: CreateDeviceReq) => api.createDevice(req),
    onSuccess: () => invalidate(),
  });
}

export function useCreateBooking() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (req: BookingCreateReq) => api.createBooking(req),
    onSuccess: () => invalidate([queryKeys.bookingsAll, queryKeys.customersAll]),
  });
}

export function useStartBooking() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (id: string) => api.startBooking(id),
    onSuccess: () => invalidate([queryKeys.bookingsAll]),
  });
}

export function useExtendBooking() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (v: { id: string; req: BookingExtendReq }) => api.extendBooking(v.id, v.req),
    onSuccess: () => invalidate([queryKeys.bookingsAll]),
  });
}

export function useCancelBooking() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (id: string) => api.cancelBooking(id),
    onSuccess: () => invalidate([queryKeys.bookingsAll, queryKeys.customersAll]),
  });
}

export function useUpdatePricing() {
  const invalidate = useInvalidator();
  return useMutation({
    // Pricing cascades the rate to devices of that type, so refresh the floor too.
    mutationFn: (v: { id: string; req: PricingUpdateReq }) => api.updatePricing(v.id, v.req),
    onSuccess: () => invalidate([queryKeys.pricing]),
  });
}
