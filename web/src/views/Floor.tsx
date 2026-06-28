// Floor / Device Monitor — the flagship live-ops screen. Ported from
// _design_ref/gg-app.jsx (Floor + Drawer) and wired to the real API:
// useDevices() polls the snapshot every 10s, tiles tick a 1s clock for live
// countdowns + accrued tabs, and every action goes through a typed mutation that
// auto-invalidates the floor. The header's "Check Availability" button opens the
// AvailabilityDrawer (check a slot + book / seat a walk-in from one panel).
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEVICE_TYPES,
  type DeviceType,
  type DeviceSnapshot,
  type DeviceLiveStatus,
  accruedPaise,
  quotePaise,
  formatPaise,
} from '@arenaze/shared';
import {
  useDevices,
  useDashboardTiles,
  useStartDevice,
  useEndSession,
  useExtendDevice,
  usePatchDevice,
} from '../api/queries';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Metric } from '../components/Metric';
import { Chip } from '../components/Chip';
import { Pill, type PillKind } from '../components/Pill';
import { Drawer } from '../components/Drawer';
import { AvailabilityDrawer } from '../components/AvailabilityDrawer';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------
function fmtLeft(ms: number): string {
  if (ms <= 0) return 'OVERDUE';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function apiErr(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof ApiError ? e.message : fallback;
}

// Floor tile class for a live status. available + reserved both render as `.free`
// (open bay), with reserved differentiated by its `.tm` content/colour.
function tileClass(status: DeviceLiveStatus): 'active' | 'free' | 'maint' {
  if (status === 'active') return 'active';
  if (status === 'maintenance') return 'maint';
  return 'free';
}

const HEADER_PILL: Record<DeviceLiveStatus, PillKind> = {
  available: 'ok',
  active: 'busy',
  reserved: 'warn',
  maintenance: 'off',
};
const HEADER_TXT: Record<DeviceLiveStatus, string> = {
  available: 'Available',
  active: 'In session',
  reserved: 'Reserved',
  maintenance: 'Maintenance',
};

const DURATIONS = [30, 60, 120];

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------
export function Floor() {
  const devicesQ = useDevices();
  const tilesQ = useDashboardTiles();

  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<Set<DeviceType>>(new Set());
  const [selId, setSelId] = useState<string | null>(null);
  const [availOpen, setAvailOpen] = useState(false);
  const [flash, setFlash] = useState<Set<string>>(new Set());

  // 1s tick drives the live countdowns + accrued tabs.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const flashBays = useCallback((ids: string[]) => {
    setFlash(new Set(ids));
    window.setTimeout(() => setFlash(new Set()), 1600);
  }, []);

  const devices = devicesQ.data ?? [];
  const selected = devices.find((d) => d.id === selId) ?? null;
  const tiles = tilesQ.data;

  const toggleType = (t: DeviceType) => {
    setFilter((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  const renderTile = (d: DeviceSnapshot) => {
    const cls = tileClass(d.status);
    return (
      <div
        key={d.id}
        className={'tile ' + cls + (flash.has(d.id) ? ' flash' : '')}
        onClick={() => {
          setAvailOpen(false);
          setSelId(d.id);
        }}
      >
        <span className="bar" />
        <span className="pf">{d.type}</span>
        <div className="id">{d.label}</div>
        <div className="spec">{d.spec}</div>

        {d.status === 'active' && d.session && (
          <>
            <div className="who">{d.session.playerLabel}</div>
            <div
              className="tm"
              style={
                Date.parse(d.session.plannedEndAt ?? '') - now <= 0
                  ? { color: 'var(--red)', fontWeight: 700 }
                  : undefined
              }
            >
              {fmtLeft((d.session.plannedEndAt ? Date.parse(d.session.plannedEndAt) : now) - now)}
            </div>
            <div className="tm" style={{ color: 'var(--dim)' }}>
              {formatPaise(accruedPaise((now - Date.parse(d.session.startedAt)) / 1000, d.session.ratePaise))}
            </div>
          </>
        )}

        {d.status === 'available' && (
          <>
            <div className="who" style={{ color: 'var(--faint)' }}>
              Open bay
            </div>
            <div className="tm">Available</div>
          </>
        )}

        {d.status === 'reserved' && (
          <>
            <div className="who">{d.reservation?.customerName ?? 'Reserved'}</div>
            <div className="tm" style={{ color: 'var(--warn)' }}>
              Res · {d.reservation ? fmtTime(d.reservation.startAt) : '—'}
            </div>
          </>
        )}

        {d.status === 'maintenance' && (
          <>
            <div className="who" style={{ color: 'var(--faint)' }}>
              Offline
            </div>
            <div className="tm">Maintenance</div>
          </>
        )}
      </div>
    );
  };

  // Group into one section per device type (PRD: a section for every type).
  const sections = useMemo(() => {
    return DEVICE_TYPES.map((type) => ({
      type,
      list: devices.filter((d) => d.type === type),
    })).filter((s) => s.list.length > 0 && (filter.size === 0 || filter.has(s.type)));
  }, [devices, filter]);

  return (
    <>
      {/* metrics */}
      <div className="metrics">
        <Metric
          k="Utilization"
          v={tiles ? tiles.occupancyRate : '—'}
          unit="%"
          sub={tiles ? `${tiles.capacity} bays online` : ''}
          subc="up"
        />
        <Metric
          k="Revenue · today"
          v={tiles ? formatPaise(tiles.revenueTodayPaise, { compact: true }) : '—'}
          sub="billed today"
        />
        <Metric k="Open bays" v={tiles ? tiles.freeCount : '—'} sub="ready to seat" />
        <Metric
          k="Active sessions"
          v={tiles ? tiles.activeCount : '—'}
          sub={tiles ? `${tiles.reservedCount} reserved today` : ''}
        />
      </div>

      {/* head + check-availability */}
      <div className="shead">
        <div className="t">
          Floor · Live
          <span className="ct">{devices.length} STATIONS</span>
        </div>
        <button
          className="btn primary sm"
          onClick={() => {
            setSelId(null);
            setAvailOpen(true);
          }}
        >
          Check Availability
        </button>
      </div>

      {/* platform filters */}
      <div className="filters">
        {DEVICE_TYPES.map((t) => (
          <Chip key={t} on={filter.has(t)} dot onClick={() => toggleType(t)}>
            {t}
          </Chip>
        ))}
        {filter.size > 0 && (
          <button className="chip" onClick={() => setFilter(new Set())}>
            Clear
          </button>
        )}
      </div>

      {/* floor */}
      {devicesQ.isLoading && <div className="empty">Loading floor…</div>}
      {devicesQ.isError && <div className="empty">{apiErr(devicesQ.error)}</div>}
      {!devicesQ.isLoading && !devicesQ.isError && devices.length === 0 && (
        <div className="empty">No devices on this floor</div>
      )}
      {!devicesQ.isLoading && !devicesQ.isError && devices.length > 0 && sections.length === 0 && (
        <div className="empty">No stations match filter</div>
      )}

      {sections.map(({ type, list }) => {
        const free = list.filter((d) => d.status === 'available').length;
        return (
          <section key={type} style={{ marginBottom: 'var(--gap)' }}>
            <div className="shead">
              <div className="t" style={{ fontSize: 16 }}>
                {type}
                <span className="ct">
                  {list.length} STATIONS · {free} FREE
                </span>
              </div>
            </div>
            <div className="stations">{list.map(renderTile)}</div>
          </section>
        );
      })}

      {selected && (
        <StationDrawer
          key={selected.id}
          device={selected}
          now={now}
          onClose={() => setSelId(null)}
          onFlash={flashBays}
        />
      )}

      {availOpen && (
        <AvailabilityDrawer
          devices={devices}
          onClose={() => setAvailOpen(false)}
          onBooked={(ids) => {
            setFilter(new Set());
            flashBays(ids);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Station drawer — start / end / extend / maintenance, by status.
// ---------------------------------------------------------------------------
function StationDrawer({
  device,
  now,
  onClose,
  onFlash,
}: {
  device: DeviceSnapshot;
  now: number;
  onClose: () => void;
  onFlash: (ids: string[]) => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { notify } = useToast();

  const [name, setName] = useState('');
  const [dur, setDur] = useState(60);

  const startM = useStartDevice();
  const endM = useEndSession();
  const extendM = useExtendDevice();
  const patchM = usePatchDevice();

  const s = device;

  const doStart = () => {
    const label = name.trim() || 'Walk-in';
    startM.mutate(
      { id: s.id, req: { playerLabel: label, durationMinutes: dur } },
      {
        onSuccess: (res) => {
          onFlash([res.device.id]);
          onClose();
          notify(
            <>
              Started <b>{label}</b> on <b>{res.device.label}</b> · {dur} min
            </>,
          );
        },
        onError: (e) => notify(apiErr(e)),
      },
    );
  };

  const doEnd = () => {
    endM.mutate(s.id, {
      onSuccess: (res) => {
        onClose();
        notify(
          <>
            <b>{s.label}</b> checked out · collect <b>{formatPaise(res.chargedPaise)}</b>
          </>,
        );
      },
      onError: (e) => notify(apiErr(e)),
    });
  };

  const doExtend = () => {
    extendM.mutate(
      { id: s.id, req: { minutes: 30 } },
      {
        onSuccess: (dev) => notify(<><b>{dev.label}</b> extended · +30 min</>),
        onError: (e) => notify(apiErr(e)),
      },
    );
  };

  const doMaint = () => {
    patchM.mutate(
      { id: s.id, req: { status: 'maintenance' } },
      {
        onSuccess: (dev) => {
          onClose();
          notify(<><b>{dev.label}</b> set to maintenance</>);
        },
        onError: (e) => notify(apiErr(e)),
      },
    );
  };

  const doBringOnline = () => {
    patchM.mutate(
      { id: s.id, req: { status: 'available' } },
      {
        onSuccess: (dev) => {
          onClose();
          notify(<><b>{dev.label}</b> back online</>);
        },
        onError: (e) => notify(apiErr(e)),
      },
    );
  };

  const header = (
    <>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: 30,
          textTransform: 'uppercase',
          lineHeight: 1,
        }}
      >
        {s.label}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--faint)',
          letterSpacing: '.1em',
          marginTop: 6,
          textTransform: 'uppercase',
        }}
      >
        {s.type} · {s.spec}
      </div>
      <div style={{ marginTop: 12 }}>
        <Pill kind={HEADER_PILL[s.status]}>{HEADER_TXT[s.status]}</Pill>
      </div>
    </>
  );

  // ---- active ----
  if (s.status === 'active' && s.session) {
    const left = (s.session.plannedEndAt ? Date.parse(s.session.plannedEndAt) : now) - now;
    const over = left <= 0;
    const elapsedMin = Math.floor((now - Date.parse(s.session.startedAt)) / 60000);
    const tab = accruedPaise((now - Date.parse(s.session.startedAt)) / 1000, s.session.ratePaise);
    return (
      <Drawer
        open
        onClose={onClose}
        header={header}
        footer={
          <>
            <button className="btn ghost sm" onClick={doExtend} disabled={extendM.isPending}>
              +30 min
            </button>
            <button
              className="btn primary"
              style={{ flex: 1 }}
              onClick={doEnd}
              disabled={endM.isPending}
            >
              {endM.isPending ? 'Ending…' : 'End & Checkout'}
            </button>
          </>
        }
      >
        <div style={{ textAlign: 'center', padding: '14px 0 22px' }}>
          <div
            className="mono"
            style={{ fontSize: 10, letterSpacing: '.16em', color: 'var(--faint)', textTransform: 'uppercase' }}
          >
            Time remaining
          </div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 700,
              fontSize: 56,
              lineHeight: 1,
              marginTop: 8,
              color: over ? 'var(--red)' : 'var(--text)',
            }}
          >
            {fmtLeft(left)}
          </div>
        </div>
        <dl className="dl">
          <dt>Player</dt>
          <dd>{s.session.playerLabel}</dd>
          <dt>Elapsed</dt>
          <dd>{elapsedMin} min</dd>
          <dt>Rate</dt>
          <dd className="mono">{formatPaise(s.session.ratePaise)}/hr</dd>
          <dt>Running tab</dt>
          <dd className="mono" style={{ color: 'var(--red-bright)' }}>
            {formatPaise(tab)}
          </dd>
        </dl>
      </Drawer>
    );
  }

  // ---- maintenance ----
  if (s.status === 'maintenance') {
    return (
      <Drawer
        open
        onClose={onClose}
        header={header}
        footer={
          isAdmin ? (
            <button
              className="btn maroon"
              style={{ flex: 1 }}
              onClick={doBringOnline}
              disabled={patchM.isPending}
            >
              {patchM.isPending ? 'Working…' : 'Bring Online'}
            </button>
          ) : undefined
        }
      >
        <p style={{ color: 'var(--dim)', fontSize: 14, lineHeight: 1.7 }}>
          This bay is flagged for maintenance and hidden from booking inventory. Bring it back
          online when it&apos;s ready for players.
        </p>
        {!isAdmin && <div className="note">Ask an admin to bring this bay back online.</div>}
      </Drawer>
    );
  }

  // ---- available / reserved ----
  return (
    <Drawer
      open
      onClose={onClose}
      header={header}
      footer={
        <>
          {isAdmin && (
            <button className="btn ghost sm" onClick={doMaint} disabled={patchM.isPending}>
              Maintenance
            </button>
          )}
          <button
            className="btn primary"
            style={{ flex: 1 }}
            onClick={doStart}
            disabled={startM.isPending}
          >
            {startM.isPending ? 'Starting…' : 'Start Session'}
          </button>
        </>
      }
    >
      {s.status === 'reserved' && s.reservation && (
        <div className="note" style={{ marginBottom: 16, marginTop: 0 }}>
          Reserved · {s.reservation.customerName ?? 'Guest'} · {fmtTime(s.reservation.startAt)}–
          {fmtTime(s.reservation.endAt)} ({s.reservation.code})
        </div>
      )}
      <div className="field" style={{ marginBottom: 16 }}>
        <span className="lab">Player / handle</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Walk-in or member"
        />
      </div>
      <div className="field">
        <span className="lab">Duration</span>
        <div className="seg">
          {DURATIONS.map((d) => (
            <Chip key={d} on={dur === d} onClick={() => setDur(d)}>
              {d} min
            </Chip>
          ))}
        </div>
      </div>
      <dl className="dl" style={{ marginTop: 20 }}>
        <dt>Rate</dt>
        <dd className="mono">{formatPaise(s.ratePaise)}/hr</dd>
        <dt>Est. charge</dt>
        <dd className="mono" style={{ color: 'var(--red-bright)' }}>
          {formatPaise(quotePaise(dur, s.ratePaise))}
        </dd>
      </dl>
    </Drawer>
  );
}
