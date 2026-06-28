// Customers (CRM) — ported from the design's Members table, backed by the real
// customer dataset (derived from bookings). Search by name/contact number; click a
// row to open a detail Drawer with tier, lifetime totals, and booking history.
import { useEffect, useState } from 'react';
import {
  type BookingStatus,
  type CustomerDTO,
  formatPaise,
} from '@arenaze/shared';
import { useCustomers, useCustomer } from '../api/queries';
import { ApiError } from '../api/client';
import { Pill, type PillKind } from '../components/Pill';
import { Drawer } from '../components/Drawer';

const STATUS_PILL: Record<BookingStatus, PillKind> = {
  active: 'busy',
  upcoming: 'warn',
  completed: 'ok',
  cancelled: 'off',
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleDateString([], { day: '2-digit', month: 'short' }) +
    ' · ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short' });
}
function apiErr(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function Customers() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [selId, setSelId] = useState<string | null>(null);

  // Debounce keystrokes into the actual query.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(text), 300);
    return () => window.clearTimeout(id);
  }, [text]);

  const customersQ = useCustomers(query);
  const detailQ = useCustomer(selId ?? '');

  const rows = customersQ.data ?? [];

  return (
    <>
      <div className="shead">
        <div className="t">
          Customers
          <span className="ct">{rows.length} MEMBERS</span>
        </div>
      </div>

      <div className="searchbar">
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by name or number…"
        />
        <button className="btn primary" onClick={() => setQuery(text)}>
          Search
        </button>
      </div>

      {customersQ.isLoading && <div className="empty">Loading customers…</div>}
      {customersQ.isError && <div className="empty">{apiErr(customersQ.error)}</div>}
      {!customersQ.isLoading && !customersQ.isError && rows.length === 0 && (
        <div className="empty">No customers found</div>
      )}

      {rows.length > 0 && (
        <div className="panel">
          <table className="tbl">
            <thead>
              <tr>
                <th>Member</th>
                <th>Contact</th>
                <th>Tier</th>
                <th>Hours</th>
                <th>Lifetime spend</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c: CustomerDTO) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setSelId(c.id)}>
                  <td>
                    <b>{c.name}</b>
                  </td>
                  <td className="mono" style={{ fontSize: 13 }}>
                    {c.phone || '—'}
                  </td>
                  <td>
                    <span className={'tier ' + c.tier}>{c.tier}</span>
                  </td>
                  <td className="mono">{c.hours}h</td>
                  <td className="mono">
                    <b>{formatPaise(c.spendPaise)}</b>
                  </td>
                  <td style={{ color: 'var(--dim)' }}>{fmtDateTime(c.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={!!selId}
        onClose={() => setSelId(null)}
        header={
          detailQ.data ? (
            <>
              <div
                style={{
                  fontFamily: 'var(--f-display)',
                  fontWeight: 700,
                  fontSize: 28,
                  textTransform: 'uppercase',
                  lineHeight: 1,
                }}
              >
                {detailQ.data.name}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--faint)',
                  letterSpacing: '.1em',
                  marginTop: 6,
                }}
              >
                {detailQ.data.phone || 'No contact number'}
              </div>
              <div style={{ marginTop: 12 }}>
                <span className={'tier ' + detailQ.data.tier}>{detailQ.data.tier}</span>
              </div>
            </>
          ) : (
            <div
              style={{
                fontFamily: 'var(--f-display)',
                fontWeight: 700,
                fontSize: 22,
                textTransform: 'uppercase',
              }}
            >
              Customer
            </div>
          )
        }
      >
        {detailQ.isLoading && <div className="empty">Loading…</div>}
        {detailQ.isError && <div className="empty">{apiErr(detailQ.error)}</div>}
        {detailQ.data && (
          <>
            <dl className="dl">
              <dt>Tier</dt>
              <dd>{detailQ.data.tier}</dd>
              <dt>Play hours</dt>
              <dd className="mono">{detailQ.data.hours}h</dd>
              <dt>Lifetime spend</dt>
              <dd className="mono">{formatPaise(detailQ.data.spendPaise)}</dd>
              <dt>Visits</dt>
              <dd className="mono">{detailQ.data.visits}</dd>
              <dt>Contact</dt>
              <dd className="mono">{detailQ.data.phone || '—'}</dd>
              <dt>Last seen</dt>
              <dd>{fmtDateTime(detailQ.data.lastSeen)}</dd>
            </dl>

            <div className="label" style={{ marginTop: 26 }}>
              Booking history · {detailQ.data.bookings.length}
            </div>
            {detailQ.data.bookings.length === 0 ? (
              <div className="empty">No bookings yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {detailQ.data.bookings.map((b) => (
                  <div
                    key={b.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      border: '1px solid var(--line)',
                      padding: '11px 13px',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 13, color: 'var(--text)' }}>
                        <b>{b.code}</b>
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>
                        {fmtDate(b.startAt)} · {fmtTime(b.startAt)}–{fmtTime(b.endAt)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
                      <span className="mono" style={{ fontSize: 13 }}>
                        {formatPaise(b.totalPaise)}
                      </span>
                      <Pill kind={STATUS_PILL[b.status]}>{b.status}</Pill>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Drawer>
    </>
  );
}
