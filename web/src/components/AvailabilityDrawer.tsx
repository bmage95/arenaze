// Check Availability + Book — opens in the right-side drawer straight off the
// Floor (replaces the old standalone Availability page *and* the walk-in button).
// Search a slot by type / guests / in-time / duration / extendable, then book
// from the same panel capturing the customer's name + contact number. Because an
// in-time of "now" creates an already-active booking server-side, booking now
// seats a walk-in — so this one panel covers both jobs. Laid out single-column
// to fit the narrow drawer.
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  DEVICE_TYPES,
  type DeviceType,
  type DeviceSnapshot,
  type AvailabilitySearchReq,
  type AvailabilitySearchRes,
  type AvailabilitySlot,
  type BookingCreateReq,
  formatPaise,
} from '@arenaze/shared';
import { ApiError, searchAvailability } from '../api/client';
import { useCreateBooking } from '../api/queries';
import { useToast } from './Toast';
import { Drawer } from './Drawer';
import { Chip } from './Chip';
import { Pill } from './Pill';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });
}
function apiErr(e: unknown, fallback = 'Search failed'): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function AvailabilityDrawer({
  devices,
  onClose,
  onBooked,
}: {
  devices: DeviceSnapshot[];
  onClose: () => void;
  onBooked: (deviceIds: string[]) => void;
}) {
  const { notify } = useToast();

  const [deviceType, setDeviceType] = useState<DeviceType>('PC');
  const [guests, setGuests] = useState(1);
  const [inTime, setInTime] = useState(() => toLocalInput(new Date()));
  const [hours, setHours] = useState(2);
  const [extendable, setExtendable] = useState(false);

  const [result, setResult] = useState<AvailabilitySearchRes | null>(null);
  const [searchedReq, setSearchedReq] = useState<AvailabilitySearchReq | null>(null);

  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');

  const searchM = useMutation<AvailabilitySearchRes, ApiError, AvailabilitySearchReq>({
    mutationFn: searchAvailability,
  });
  const createM = useCreateBooking();

  // Live "free now" counts per platform — a quick hint while picking the type.
  const freeNow = useMemo(() => {
    const m = {} as Record<DeviceType, number>;
    for (const t of DEVICE_TYPES) m[t] = 0;
    for (const d of devices) if (d.status === 'available') m[d.type] += 1;
    return m;
  }, [devices]);

  const buildReq = (): AvailabilitySearchReq => ({
    deviceType,
    guests,
    startAt: new Date(inTime).toISOString(),
    durationMinutes: Math.round(hours * 60),
    extendable,
  });

  const runSearch = (req: AvailabilitySearchReq) => {
    searchM.mutate(req, {
      onSuccess: (res) => {
        setResult(res);
        setSearchedReq(req);
      },
      onError: (e) => notify(apiErr(e)),
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    runSearch(buildReq());
  };

  const searchNearest = (slot: AvailabilitySlot) => {
    if (!searchedReq) return;
    setInTime(toLocalInput(new Date(slot.startAt)));
    runSearch({ ...searchedReq, startAt: slot.startAt });
  };

  const book = () => {
    if (!searchedReq) return;
    const req: BookingCreateReq = {
      ...searchedReq,
      customer: { name: custName.trim(), phone: custPhone.trim() || undefined },
    };
    createM.mutate(req, {
      onSuccess: (b) => {
        onBooked(b.devices.map((d) => d.deviceId));
        notify(
          <>
            Booked <b>{b.code}</b> · {formatPaise(b.totalPaise)}
          </>,
        );
        onClose();
      },
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'slot_taken') {
          notify('Slot just taken — searching again');
          runSearch(searchedReq);
        } else {
          notify(apiErr(e, 'Booking failed'));
        }
      },
    });
  };

  // A booking now requires both a name and a real contact number (>= 10 digits).
  const phoneValid = custPhone.replace(/\D/g, '').length >= 10;
  const canBook = custName.trim().length > 0 && phoneValid && !createM.isPending;
  const formValid = guests >= 1 && hours >= 1 && inTime !== '';

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
        Check Availability
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
        Find a slot &amp; book
      </div>
    </>
  );

  return (
    <Drawer open onClose={onClose} header={header}>
      <form onSubmit={onSubmit}>
        <div className="field" style={{ marginBottom: 16 }}>
          <span className="lab">Device type</span>
          <div className="seg">
            {DEVICE_TYPES.map((t) => (
              <Chip key={t} on={deviceType === t} dot onClick={() => setDeviceType(t)}>
                {t} · {freeNow[t]}
              </Chip>
            ))}
          </div>
        </div>

        <div className="row" style={{ marginBottom: 16, gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <span className="lab">Guests</span>
            <input
              className="input"
              type="number"
              min={1}
              value={guests}
              onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <span className="lab">Hours</span>
            <input
              className="input"
              type="number"
              min={1}
              step={1}
              value={hours}
              onChange={(e) => setHours(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 16 }}>
          <span className="lab">In-time</span>
          <input
            className="input"
            type="datetime-local"
            value={inTime}
            onChange={(e) => setInTime(e.target.value)}
          />
        </div>

        <div className="field" style={{ marginBottom: 18 }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 9,
              color: 'var(--dim)',
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={extendable}
              onChange={(e) => setExtendable(e.target.checked)}
            />
            Hold the machine for the rest of the day
          </label>
        </div>

        <button
          className="btn primary"
          type="submit"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={!formValid || searchM.isPending}
        >
          {searchM.isPending ? 'Checking…' : 'Check Availability'}
        </button>
      </form>

      {searchM.isError && !searchM.isPending && (
        <div className="note" style={{ color: 'var(--red-bright)' }}>{apiErr(searchM.error)}</div>
      )}

      {result && searchedReq && !searchM.isPending && (
        <Results
          result={result}
          req={searchedReq}
          custName={custName}
          custPhone={custPhone}
          setCustName={setCustName}
          setCustPhone={setCustPhone}
          canBook={canBook}
          booking={createM.isPending}
          onBook={book}
          onSearchNearest={searchNearest}
        />
      )}
    </Drawer>
  );
}

function Matches({ slot, extendable }: { slot: AvailabilitySlot; extendable: boolean }) {
  if (slot.matches.length === 0) {
    return <div className="note">No machines free in this window</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {slot.matches.map((m) => (
        <div
          key={m.deviceId}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            border: '1px solid var(--line)',
            padding: '10px 12px',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>{m.label}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
              {m.spec}
            </div>
          </div>
          <div style={{ textAlign: 'right', flex: 'none' }}>
            <div className="mono" style={{ fontSize: 13 }}>
              {formatPaise(m.ratePaise)}/hr
            </div>
            {extendable && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
                till {m.availableTill ? fmtTime(m.availableTill) : '—'}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Results({
  result,
  req,
  custName,
  custPhone,
  setCustName,
  setCustPhone,
  canBook,
  booking,
  onBook,
  onSearchNearest,
}: {
  result: AvailabilitySearchRes;
  req: AvailabilitySearchReq;
  custName: string;
  custPhone: string;
  setCustName: (v: string) => void;
  setCustPhone: (v: string) => void;
  canBook: boolean;
  booking: boolean;
  onBook: () => void;
  onSearchNearest: (slot: AvailabilitySlot) => void;
}) {
  const { slot, nearest, ok } = result;
  const quote = useMemo(() => formatPaise(slot.quotePaise), [slot.quotePaise]);

  return (
    <div style={{ marginTop: 22, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
      <div className="shead" style={{ margin: '0 0 12px' }}>
        <div className="t" style={{ fontSize: 15 }}>
          Results
        </div>
        {ok ? <Pill kind="ok">Available</Pill> : <Pill kind="warn">Not enough</Pill>}
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 12 }}>
        {req.guests}× {req.deviceType} · {fmtDate(slot.startAt)} · {fmtTime(slot.startAt)}–
        {fmtTime(slot.endAt)}
      </div>

      <Matches slot={slot} extendable={req.extendable} />

      {ok ? (
        <div style={{ marginTop: 20 }}>
          <div className="label">Book now</div>
          <div className="field" style={{ marginBottom: 14 }}>
            <span className="lab">Customer name</span>
            <input
              className="input"
              value={custName}
              onChange={(e) => setCustName(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div className="field" style={{ marginBottom: 16 }}>
            <span className="lab">Contact number</span>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              value={custPhone}
              onChange={(e) => setCustPhone(e.target.value)}
              placeholder="e.g. 98765 43210"
            />
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
            }}
          >
            <span className="lab" style={{ margin: 0 }}>
              Total
            </span>
            <span className="mono" style={{ fontSize: 20, color: 'var(--text)' }}>
              {quote}
            </span>
          </div>
          <button
            className="btn maroon"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={onBook}
            disabled={!canBook}
          >
            {booking ? 'Booking…' : `Book ${req.guests}× ${req.deviceType} →`}
          </button>
          {!canBook && !booking && (
            <div className="note">
              {custName.trim().length === 0
                ? 'Enter a customer name to confirm.'
                : 'Enter a 10-digit contact number to confirm.'}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 20 }}>
          <div className="label">Recommendation</div>
          {nearest ? (
            <>
              <p style={{ color: 'var(--dim)', fontSize: 13, lineHeight: 1.7, margin: '0 0 14px' }}>
                No {req.guests}× {req.deviceType} free at {fmtTime(slot.startAt)} — nearest slot that
                seats {req.guests} is{' '}
                <b style={{ color: 'var(--text)' }}>
                  {fmtDate(nearest.startAt)} · {fmtTime(nearest.startAt)}–{fmtTime(nearest.endAt)}
                </b>
                .
              </p>
              <Matches slot={nearest} extendable={req.extendable} />
              <button
                className="btn ghost"
                style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
                onClick={() => onSearchNearest(nearest)}
              >
                Search this slot →
              </button>
            </>
          ) : (
            <p style={{ color: 'var(--dim)', fontSize: 13, lineHeight: 1.7, margin: 0 }}>
              No later slot today can seat {req.guests}× {req.deviceType}. Try fewer guests or a
              different platform.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
