// Booking Ledger — the active dataset behind the availability engine. Ported from
// the design's Reservations table, with the PRD columns + a date/status filter
// and per-row cancel (upcoming/active only). Newest first.
import { useMemo, useState } from 'react';
import {
  BOOKING_STATUS,
  type BookingStatus,
  type BookingDTO,
  formatPaise,
} from '@arenaze/shared';
import { useBookings, useCancelBooking } from '../api/queries';
import { ApiError } from '../api/client';
import { useToast } from '../components/Toast';
import { Pill, type PillKind } from '../components/Pill';
import { Metric } from '../components/Metric';

const STATUS_PILL: Record<BookingStatus, PillKind> = {
  active: 'busy',
  upcoming: 'warn',
  completed: 'ok',
  cancelled: 'off',
};
const STATUS_LABEL: Record<BookingStatus, string> = {
  active: 'Active',
  upcoming: 'Upcoming',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short' });
}
function apiErr(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function Ledger() {
  const { notify } = useToast();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<BookingStatus | ''>('');

  const bookingsQ = useBookings({
    from: from || undefined,
    to: to || undefined,
    status: status || undefined,
  });
  const cancelM = useCancelBooking();

  const rows = useMemo(() => {
    const list = bookingsQ.data ?? [];
    // newest first
    return [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [bookingsQ.data]);

  // Summary tiles over the current (filtered) result set.
  const stats = useMemo(() => {
    let upcoming = 0;
    let active = 0;
    let valuePaise = 0;
    for (const b of rows) {
      if (b.status === 'upcoming') upcoming += 1;
      else if (b.status === 'active') active += 1;
      if (b.status !== 'cancelled') valuePaise += b.totalPaise;
    }
    return { total: rows.length, upcoming, active, valuePaise };
  }, [rows]);
  const loading = bookingsQ.isLoading;

  const cancel = (b: BookingDTO) => {
    if (!window.confirm(`Cancel booking ${b.code}? This frees its devices.`)) return;
    cancelM.mutate(b.id, {
      onSuccess: () => notify(<>Booking <b>{b.code}</b> cancelled</>),
      onError: (e) =>
        notify(
          e instanceof ApiError && e.code === 'invalid_transition'
            ? `Booking ${b.code} can no longer be cancelled`
            : apiErr(e),
        ),
    });
  };

  const clearFilters = () => {
    setFrom('');
    setTo('');
    setStatus('');
  };
  const hasFilter = from !== '' || to !== '' || status !== '';

  return (
    <>
      <div className="shead">
        <div className="t">
          Booking Ledger
          <span className="ct">{rows.length} BOOKINGS</span>
        </div>
      </div>

      <div className="metrics">
        <Metric k="Bookings" v={loading ? '—' : stats.total} sub={hasFilter ? 'in filter' : 'all'} />
        <Metric k="Upcoming" v={loading ? '—' : stats.upcoming} sub="reservations" />
        <Metric k="Active now" v={loading ? '—' : stats.active} sub="in session" subc="up" />
        <Metric
          k="Booked value"
          v={loading ? '—' : formatPaise(stats.valuePaise, { compact: true })}
          sub="excl. cancelled"
        />
      </div>

      <div className="row" style={{ marginBottom: 18, gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field">
          <span className="lab">From</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <span className="lab">To</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field">
          <span className="lab">Status</span>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as BookingStatus | '')}
          >
            <option value="">All</option>
            {BOOKING_STATUS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {hasFilter && (
          <button className="btn ghost sm" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      {bookingsQ.isLoading && <div className="empty">Loading bookings…</div>}
      {bookingsQ.isError && <div className="empty">{apiErr(bookingsQ.error)}</div>}
      {!bookingsQ.isLoading && !bookingsQ.isError && rows.length === 0 && (
        <div className="empty">No bookings found</div>
      )}

      {rows.length > 0 && (
        <div className="panel">
          <table className="tbl">
            <thead>
              <tr>
                <th>Booking ID</th>
                <th>Customer</th>
                <th>Guests</th>
                <th>Devices allocated</th>
                <th>Time slot</th>
                <th>Total</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const canCancel = b.status === 'upcoming' || b.status === 'active';
                const cancelling = cancelM.isPending && cancelM.variables === b.id;
                return (
                  <tr key={b.id}>
                    <td>
                      <b className="mono">{b.code}</b>
                    </td>
                    <td>
                      <b>{b.customerName ?? '—'}</b>
                    </td>
                    <td className="mono">{b.guests}</td>
                    <td>
                      {b.devices.length > 0 ? b.devices.map((d) => d.label).join(', ') : '—'}
                    </td>
                    <td className="mono" style={{ fontSize: 13 }}>
                      {fmtDate(b.startAt)} · {fmtTime(b.startAt)}–{fmtTime(b.endAt)}
                    </td>
                    <td className="mono">
                      <b>{formatPaise(b.totalPaise)}</b>
                    </td>
                    <td>
                      <Pill kind={STATUS_PILL[b.status]}>{STATUS_LABEL[b.status]}</Pill>
                    </td>
                    <td>
                      {canCancel && (
                        <button
                          className="btn ghost sm"
                          onClick={() => cancel(b)}
                          disabled={cancelling}
                        >
                          {cancelling ? 'Cancelling…' : 'Cancel'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
