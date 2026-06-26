// Check Availability + Book Now (PRD: type / guests / in-time / duration /
// extendable -> matches or a nearest-slot recommendation; "available till" for
// extendable holds). searchAvailability is request-shaped so it's driven through
// a useMutation; booking goes through the shared useCreateBooking hook.
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  DEVICE_TYPES,
  type DeviceType,
  type AvailabilitySearchReq,
  type AvailabilitySearchRes,
  type AvailabilitySlot,
  type BookingCreateReq,
  formatPaise,
} from '@arenaze/shared';
import { ApiError, searchAvailability } from '../api/client';
import { useCreateBooking } from '../api/queries';
import { useToast } from '../components/Toast';
import { Chip } from '../components/Chip';
import { Pill } from '../components/Pill';

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

export function Availability() {
  const { notify } = useToast();

  const [deviceType, setDeviceType] = useState<DeviceType>('PC');
  const [guests, setGuests] = useState(1);
  const [inTime, setInTime] = useState(() => toLocalInput(new Date()));
  const [hours, setHours] = useState(2);
  const [extendable, setExtendable] = useState(false);

  const [result, setResult] = useState<AvailabilitySearchRes | null>(null);
  const [searchedReq, setSearchedReq] = useState<AvailabilitySearchReq | null>(null);

  const [custName, setCustName] = useState('');
  const [custHandle, setCustHandle] = useState('');

  const searchM = useMutation<AvailabilitySearchRes, ApiError, AvailabilitySearchReq>({
    mutationFn: searchAvailability,
  });
  const createM = useCreateBooking();

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
      customer: { name: custName.trim(), handle: custHandle.trim() || undefined },
    };
    createM.mutate(req, {
      onSuccess: (b) => {
        notify(
          <>
            Booked <b>{b.code}</b> · {formatPaise(b.totalPaise)}
          </>,
        );
        setCustName('');
        setCustHandle('');
        runSearch(searchedReq); // refresh remaining availability
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

  const canBook = custName.trim().length > 0 && !createM.isPending;
  const formValid = guests >= 1 && hours >= 1 && inTime !== '';

  return (
    <>
      <div className="shead">
        <div className="t">Check Availability</div>
      </div>

      <form className="box" onSubmit={onSubmit} style={{ marginBottom: 'var(--gap)' }}>
        <div className="grid3">
          <div className="field">
            <span className="lab">Device type</span>
            <div className="seg">
              {DEVICE_TYPES.map((t) => (
                <Chip key={t} on={deviceType === t} dot onClick={() => setDeviceType(t)}>
                  {t}
                </Chip>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="lab">Guests</span>
            <input
              className="input"
              type="number"
              min={1}
              value={guests}
              onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div className="field">
            <span className="lab">Play time (hours)</span>
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

        <div className="row" style={{ marginTop: 16, alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <span className="lab">In-time</span>
            <input
              className="input"
              type="datetime-local"
              value={inTime}
              onChange={(e) => setInTime(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <span className="lab">Extendable</span>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 9,
                padding: '12px 0',
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
          <button className="btn primary" type="submit" disabled={!formValid || searchM.isPending}>
            {searchM.isPending ? 'Checking…' : 'Check Availability'}
          </button>
        </div>
      </form>

      {searchM.isPending && <div className="empty">Searching…</div>}
      {searchM.isError && !searchM.isPending && (
        <div className="empty">{apiErr(searchM.error)}</div>
      )}

      {result && searchedReq && !searchM.isPending && (
        <Results
          result={result}
          req={searchedReq}
          custName={custName}
          custHandle={custHandle}
          setCustName={setCustName}
          setCustHandle={setCustHandle}
          canBook={canBook}
          booking={createM.isPending}
          onBook={book}
          onSearchNearest={searchNearest}
        />
      )}
    </>
  );
}

function MatchesTable({ slot, extendable }: { slot: AvailabilitySlot; extendable: boolean }) {
  if (slot.matches.length === 0) {
    return <div className="empty">No machines free in this window</div>;
  }
  return (
    <div className="panel">
      <table className="tbl">
        <thead>
          <tr>
            <th>Device</th>
            <th>Spec</th>
            <th>Rate</th>
            {extendable && <th>Available till</th>}
          </tr>
        </thead>
        <tbody>
          {slot.matches.map((m) => (
            <tr key={m.deviceId}>
              <td>
                <b>{m.label}</b>
              </td>
              <td className="mono" style={{ fontSize: 13 }}>
                {m.spec}
              </td>
              <td className="mono">{formatPaise(m.ratePaise)}/hr</td>
              {extendable && (
                <td className="mono" style={{ fontSize: 13 }}>
                  {m.availableTill ? fmtTime(m.availableTill) : '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Results({
  result,
  req,
  custName,
  custHandle,
  setCustName,
  setCustHandle,
  canBook,
  booking,
  onBook,
  onSearchNearest,
}: {
  result: AvailabilitySearchRes;
  req: AvailabilitySearchReq;
  custName: string;
  custHandle: string;
  setCustName: (v: string) => void;
  setCustHandle: (v: string) => void;
  canBook: boolean;
  booking: boolean;
  onBook: () => void;
  onSearchNearest: (slot: AvailabilitySlot) => void;
}) {
  const { slot, nearest, ok } = result;
  const quote = useMemo(() => formatPaise(slot.quotePaise), [slot.quotePaise]);

  return (
    <>
      <div className="shead">
        <div className="t" style={{ fontSize: 16 }}>
          Results
          <span className="ct">
            {req.guests}× {req.deviceType} · {fmtDate(slot.startAt)} · {fmtTime(slot.startAt)}–
            {fmtTime(slot.endAt)}
          </span>
        </div>
        {ok ? <Pill kind="ok">Available</Pill> : <Pill kind="warn">Not enough</Pill>}
      </div>

      <MatchesTable slot={slot} extendable={req.extendable} />

      {ok ? (
        <div className="box" style={{ marginTop: 'var(--gap)' }}>
          <div className="label">Book now</div>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <span className="lab">Customer name</span>
              <input
                className="input"
                value={custName}
                onChange={(e) => setCustName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <span className="lab">Handle (optional)</span>
              <input
                className="input"
                value={custHandle}
                onChange={(e) => setCustHandle(e.target.value)}
                placeholder="gamer.tag"
              />
            </div>
            <div className="field">
              <span className="lab">Total</span>
              <div className="mono" style={{ fontSize: 22, padding: '6px 0', color: 'var(--text)' }}>
                {quote}
              </div>
            </div>
            <button className="btn maroon" onClick={onBook} disabled={!canBook}>
              {booking ? 'Booking…' : `Book ${req.guests}× ${req.deviceType} →`}
            </button>
          </div>
          {!canBook && !booking && <div className="note">Enter a customer name to confirm.</div>}
        </div>
      ) : (
        <div className="box" style={{ marginTop: 'var(--gap)' }}>
          <div className="label">Recommendation</div>
          {nearest ? (
            <>
              <p style={{ color: 'var(--dim)', fontSize: 14, lineHeight: 1.7, margin: '0 0 14px' }}>
                No {req.guests}× {req.deviceType} free at {fmtTime(slot.startAt)} — nearest slot that
                seats {req.guests} is{' '}
                <b style={{ color: 'var(--text)' }}>
                  {fmtDate(nearest.startAt)} · {fmtTime(nearest.startAt)}–{fmtTime(nearest.endAt)}
                </b>
                .
              </p>
              <MatchesTable slot={nearest} extendable={req.extendable} />
              <div className="btnrow" style={{ marginTop: 14 }}>
                <button className="btn ghost" onClick={() => onSearchNearest(nearest)}>
                  Search this slot →
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--dim)', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              No later slot today can seat {req.guests}× {req.deviceType}. Try fewer guests or a
              different platform.
            </p>
          )}
        </div>
      )}
    </>
  );
}
