// Analytics (admin) — utilization + revenue charts (from /api/analytics/overview)
// plus the Account Ledger: a filterable invoice table where each row opens the
// entire bill. Invoices come from /api/analytics/invoices.
import { useEffect, useState } from 'react';
import {
  formatPaise,
  type InvoicePeriod,
  type InvoiceStatus,
  type InvoiceDTO,
} from '@arenaze/shared';
import {
  useAnalyticsOverview,
  useInvoices,
  useInvoice,
  useUpdateInvoiceStatus,
} from '../api/queries';
import { ApiError } from '../api/client';
import { Metric } from '../components/Metric';
import { Pill, type PillKind } from '../components/Pill';
import { Chip } from '../components/Chip';
import { Drawer } from '../components/Drawer';
import { useToast } from '../components/Toast';

const clamp = (n: number) => Math.max(0, Math.min(100, n));

function apiErr(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof ApiError ? e.message : fallback;
}
function fmtDateTime(iso: string): string {
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

export function Analytics() {
  const overviewQ = useAnalyticsOverview();

  if (overviewQ.isLoading) {
    return <div className="empty">Loading analytics…</div>;
  }
  if (overviewQ.isError) {
    const e = overviewQ.error;
    if (e instanceof ApiError && e.code === 'forbidden') {
      return <div className="empty">Admin access required</div>;
    }
    return <div className="empty">{apiErr(overviewQ.error, 'Failed to load analytics')}</div>;
  }

  const data = overviewQ.data;
  if (!data) return <div className="empty">No analytics</div>;

  const { metrics, utilByHour, revenueByDay } = data;
  const maxRev = Math.max(1, ...revenueByDay.map((d) => d.valuePaise));
  const weekTotal = revenueByDay.reduce((sum, d) => sum + d.valuePaise, 0);
  const avgHours = (metrics.avgSessionMinutes / 60).toFixed(1).replace(/\.0$/, '');

  return (
    <>
      <div className="metrics">
        <Metric k="Utilization · now" v={metrics.utilizationNow} unit="%" sub="live floor" subc="up" />
        <Metric
          k="Revenue · today"
          v={formatPaise(metrics.revenueTodayPaise, { compact: true })}
          sub="billed sessions"
        />
        <Metric k="Sessions · today" v={metrics.sessionsToday} sub="started today" />
        <Metric
          k="Avg. session"
          v={avgHours}
          unit="h"
          sub={`${formatPaise(metrics.avgTicketPaise)} avg ticket`}
        />
      </div>

      <div className="charts">
        <div className="chart">
          <div className="shead" style={{ margin: 0 }}>
            <div className="t" style={{ fontSize: 15 }}>
              Utilization by hour
            </div>
          </div>
          {utilByHour.length === 0 ? (
            <div className="empty">No data</div>
          ) : (
            <div className="bars">
              {utilByHour.map((x) => (
                <div key={x.hour} className="b" title={`${x.hour} · ${x.value}%`}>
                  <div className="col2" style={{ height: clamp(x.value) + '%' }} />
                  <div className="lb">{x.hour}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="chart">
          <div className="shead" style={{ margin: 0 }}>
            <div className="t" style={{ fontSize: 15 }}>
              Revenue · 7d
              <span className="ct" style={{ marginLeft: 8 }}>
                {formatPaise(weekTotal, { compact: true })}
              </span>
            </div>
          </div>
          {revenueByDay.length === 0 ? (
            <div className="empty">No data</div>
          ) : (
            <div className="bars">
              {revenueByDay.map((x) => (
                <div key={x.day} className="b alt" title={`${x.day} · ${formatPaise(x.valuePaise)}`}>
                  <div className="col2" style={{ height: (x.valuePaise / maxRev) * 100 + '%' }} />
                  <div className="lb">{x.day}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AccountLedger />
    </>
  );
}

// ---------------------------------------------------------------------------
// Account Ledger — invoice table with period/status/search filters; each row
// opens the entire bill in a drawer. Pending invoices can be marked paid.
// ---------------------------------------------------------------------------
const PERIODS: { key: InvoicePeriod; label: string }[] = [
  { key: 'day', label: 'Today' },
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All' },
];
const INV_PILL: Record<InvoiceStatus, PillKind> = { paid: 'ok', pending: 'warn' };

function AccountLedger() {
  const { notify } = useToast();
  const [period, setPeriod] = useState<InvoicePeriod>('month');
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [selId, setSelId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setQuery(text), 300);
    return () => window.clearTimeout(id);
  }, [text]);

  const invoicesQ = useInvoices({ period, status: status || undefined, q: query || undefined });
  const markM = useUpdateInvoiceStatus();

  const invoices = invoicesQ.data?.invoices ?? [];
  const summary = invoicesQ.data?.summary;

  const markPaid = (inv: InvoiceDTO) => {
    markM.mutate(
      { id: inv.id, req: { status: 'paid' } },
      {
        onSuccess: () => notify(<>Invoice <b>{inv.invoiceNo}</b> marked paid</>),
        onError: (e) => notify(apiErr(e)),
      },
    );
  };

  return (
    <>
      <div className="shead" style={{ marginTop: 'var(--gap)' }}>
        <div className="t" style={{ fontSize: 16 }}>
          Account Ledger
          {summary && <span className="ct">{summary.count} INVOICES</span>}
        </div>
      </div>

      <div className="row" style={{ marginBottom: 16, gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field">
          <span className="lab">Period</span>
          <div className="seg">
            {PERIODS.map((p) => (
              <Chip key={p.key} on={period === p.key} onClick={() => setPeriod(p.key)}>
                {p.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="lab">Status</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | '')}>
            <option value="">All</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <span className="lab">Search</span>
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Customer or invoice #"
          />
        </div>
      </div>

      {summary && (
        <div className="metrics" style={{ marginBottom: 'var(--gap)' }}>
          <Metric k="Invoices" v={summary.count} sub="in range" />
          <Metric k="Total billed" v={formatPaise(summary.totalPaise, { compact: true })} sub="all invoices" />
          <Metric k="Collected" v={formatPaise(summary.paidPaise, { compact: true })} sub="paid" subc="up" />
          <Metric
            k="Outstanding"
            v={formatPaise(summary.pendingPaise, { compact: true })}
            sub="pending"
            subc={summary.pendingPaise > 0 ? 'down' : ''}
          />
        </div>
      )}

      {invoicesQ.isLoading && <div className="empty">Loading invoices…</div>}
      {invoicesQ.isError && <div className="empty">{apiErr(invoicesQ.error)}</div>}
      {!invoicesQ.isLoading && !invoicesQ.isError && invoices.length === 0 && (
        <div className="empty">No invoices in this range</div>
      )}

      {invoices.length > 0 && (
        <div className="panel">
          <table className="tbl">
            <thead>
              <tr>
                <th>Invoice ID</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Method</th>
                <th>Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => setSelId(inv.id)}>
                  <td>
                    <b className="mono">{inv.invoiceNo}</b>
                  </td>
                  <td>{inv.customerName ?? 'Walk-in'}</td>
                  <td style={{ color: 'var(--dim)' }}>{fmtDateTime(inv.paidAt)}</td>
                  <td className="mono" style={{ fontSize: 13 }}>
                    {inv.method}
                  </td>
                  <td className="mono">
                    <b>{formatPaise(inv.amountPaise)}</b>
                  </td>
                  <td>
                    <Pill kind={INV_PILL[inv.status]}>{inv.status}</Pill>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {inv.status === 'pending' && (
                      <button className="btn ghost sm" disabled={markM.isPending} onClick={() => markPaid(inv)}>
                        Mark paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selId && <InvoiceDrawer id={selId} onClose={() => setSelId(null)} />}
    </>
  );
}

function InvoiceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useInvoice(id);
  const inv = q.data;

  const header = (
    <>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: 26,
          textTransform: 'uppercase',
          lineHeight: 1,
        }}
      >
        {inv?.invoiceNo ?? 'Invoice'}
      </div>
      <div
        className="mono"
        style={{ fontSize: 11, color: 'var(--faint)', letterSpacing: '.1em', marginTop: 6, textTransform: 'uppercase' }}
      >
        Bill detail
      </div>
    </>
  );

  return (
    <Drawer open onClose={onClose} header={header}>
      {q.isLoading && <div className="empty">Loading…</div>}
      {q.isError && <div className="empty">{apiErr(q.error)}</div>}
      {inv && (
        <>
          <div style={{ textAlign: 'center', padding: '8px 0 18px' }}>
            <div
              className="mono"
              style={{ fontSize: 10, letterSpacing: '.16em', color: 'var(--faint)', textTransform: 'uppercase' }}
            >
              Amount
            </div>
            <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 44, lineHeight: 1, marginTop: 8 }}>
              {formatPaise(inv.amountPaise)}
            </div>
            <div style={{ marginTop: 10 }}>
              <Pill kind={INV_PILL[inv.status]}>{inv.status}</Pill>
            </div>
          </div>

          <dl className="dl">
            <dt>Customer</dt>
            <dd>{inv.customerName ?? 'Walk-in'}</dd>
            <dt>Date</dt>
            <dd>{fmtDateTime(inv.paidAt)}</dd>
            <dt>Method</dt>
            <dd>{inv.method}</dd>
            <dt>Type</dt>
            <dd style={{ textTransform: 'capitalize' }}>{inv.kind}</dd>
            {inv.bookingCode && (
              <>
                <dt>Booking</dt>
                <dd className="mono">{inv.bookingCode}</dd>
              </>
            )}
            {inv.deviceLabel && (
              <>
                <dt>Device</dt>
                <dd>{inv.deviceLabel}</dd>
              </>
            )}
            {inv.note && (
              <>
                <dt>Note</dt>
                <dd>{inv.note}</dd>
              </>
            )}
          </dl>

          {inv.booking && inv.booking.devices.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 26 }}>
                Devices on this bill
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {inv.booking.devices.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      border: '1px solid var(--line)',
                      padding: '11px 13px',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>{d.label}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>
                        {d.type} · {fmtTime(d.startAt)}–{fmtTime(d.endAt)}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 13 }}>
                      {formatPaise(d.ratePaise)}/hr
                    </span>
                  </div>
                ))}
              </div>
              <dl className="dl" style={{ marginTop: 18 }}>
                <dt>Guests</dt>
                <dd>{inv.booking.guests}</dd>
                <dt>Booking total</dt>
                <dd className="mono">{formatPaise(inv.booking.totalPaise)}</dd>
              </dl>
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
