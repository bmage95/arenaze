// Device Manager (admin) — add / edit / delete devices, set the games catalog and
// controller count per machine, and toggle maintenance. A device with booking or
// session history can't be deleted (the ledger + analytics keep referencing it) —
// retire those via maintenance instead. The add/edit form opens in the right-side
// drawer; the floor (GET /devices) is the live source so status reflects sessions.
import { useMemo, useState } from 'react';
import {
  DEVICE_TYPES,
  type DeviceType,
  type DeviceSnapshot,
  type DeviceLiveStatus,
  type CreateDeviceReq,
  type PatchDeviceReq,
  formatPaise,
  paiseToRupees,
  rupeesToPaise,
} from '@arenaze/shared';
import { useDevices, useCreateDevice, usePatchDevice, useDeleteDevice } from '../api/queries';
import { ApiError } from '../api/client';
import { useToast } from '../components/Toast';
import { Metric } from '../components/Metric';
import { Pill, type PillKind } from '../components/Pill';
import { Chip } from '../components/Chip';
import { Drawer } from '../components/Drawer';

const STATUS_PILL: Record<DeviceLiveStatus, PillKind> = {
  available: 'ok',
  active: 'busy',
  reserved: 'warn',
  maintenance: 'off',
};
const STATUS_TXT: Record<DeviceLiveStatus, string> = {
  available: 'Available',
  active: 'In session',
  reserved: 'Reserved',
  maintenance: 'Maintenance',
};

function apiErr(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof ApiError ? e.message : fallback;
}

type Editing = { mode: 'create' } | { mode: 'edit'; device: DeviceSnapshot };

export function DeviceManager() {
  const devicesQ = useDevices();
  const patchM = usePatchDevice();
  const deleteM = useDeleteDevice();
  const { notify } = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);

  const devices = devicesQ.data ?? [];
  const stats = useMemo(() => {
    let maintenance = 0;
    let controllers = 0;
    for (const d of devices) {
      if (d.status === 'maintenance') maintenance += 1;
      controllers += d.controllers;
    }
    return { total: devices.length, maintenance, controllers, platforms: new Set(devices.map((d) => d.type)).size };
  }, [devices]);

  const toggleMaint = (d: DeviceSnapshot) => {
    const next = d.status === 'maintenance' ? 'available' : 'maintenance';
    patchM.mutate(
      { id: d.id, req: { status: next } },
      {
        onSuccess: () =>
          notify(<><b>{d.label}</b> {next === 'maintenance' ? 'set to maintenance' : 'back online'}</>),
        onError: (e) => notify(apiErr(e)),
      },
    );
  };

  const remove = (d: DeviceSnapshot) => {
    if (!window.confirm(`Delete ${d.label}? This can't be undone.`)) return;
    deleteM.mutate(d.id, {
      onSuccess: () => notify(<><b>{d.label}</b> deleted</>),
      onError: (e) => notify(apiErr(e)),
    });
  };

  return (
    <>
      <div className="shead">
        <div className="t">
          Device Manager
          <span className="ct">{devices.length} DEVICES</span>
        </div>
        <button className="btn primary sm" onClick={() => setEditing({ mode: 'create' })}>
          + Add device
        </button>
      </div>

      <div className="metrics">
        <Metric k="Devices" v={stats.total} sub="on the floor" />
        <Metric k="In maintenance" v={stats.maintenance} sub="offline" />
        <Metric k="Controllers" v={stats.controllers} sub="across consoles" />
        <Metric k="Platforms" v={stats.platforms} sub="device types" />
      </div>

      {devicesQ.isLoading && <div className="empty">Loading devices…</div>}
      {devicesQ.isError && <div className="empty">{apiErr(devicesQ.error)}</div>}
      {!devicesQ.isLoading && !devicesQ.isError && devices.length === 0 && (
        <div className="empty">No devices yet — add one to get started</div>
      )}

      {devices.length > 0 && (
        <div className="panel">
          <table className="tbl">
            <thead>
              <tr>
                <th>Device</th>
                <th>Type</th>
                <th>Spec</th>
                <th>Rate</th>
                <th>Controllers</th>
                <th>Games</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>
                    <b>{d.label}</b>
                  </td>
                  <td>{d.type}</td>
                  <td className="mono" style={{ fontSize: 13 }}>
                    {d.spec || '—'}
                  </td>
                  <td className="mono">{formatPaise(d.ratePaise)}/hr</td>
                  <td className="mono">{d.controllers || '—'}</td>
                  <td style={{ maxWidth: 240, color: 'var(--dim)', fontSize: 13 }}>
                    {d.games.length ? d.games.join(', ') : '—'}
                  </td>
                  <td>
                    <Pill kind={STATUS_PILL[d.status]}>{STATUS_TXT[d.status]}</Pill>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="btn ghost sm" onClick={() => setEditing({ mode: 'edit', device: d })}>
                        Edit
                      </button>
                      <button
                        className="btn ghost sm"
                        disabled={d.status === 'active' || patchM.isPending}
                        title={d.status === 'active' ? 'End the session first' : undefined}
                        onClick={() => toggleMaint(d)}
                      >
                        {d.status === 'maintenance' ? 'Online' : 'Maintenance'}
                      </button>
                      <button className="btn ghost sm" disabled={deleteM.isPending} onClick={() => remove(d)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DeviceForm
          key={editing.mode === 'edit' ? editing.device.id : 'new'}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Add / edit form — right-side drawer. Games are entered as a comma-separated
// list; rate is captured in rupees and stored as paise.
// ---------------------------------------------------------------------------
function DeviceForm({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const { notify } = useToast();
  const createM = useCreateDevice();
  const patchM = usePatchDevice();
  const isEdit = editing.mode === 'edit';
  const dev = editing.mode === 'edit' ? editing.device : null;

  const [label, setLabel] = useState(dev?.label ?? '');
  const [type, setType] = useState<DeviceType>(dev?.type ?? 'PC');
  const [spec, setSpec] = useState(dev?.spec ?? '');
  const [rupees, setRupees] = useState(() => String(dev ? paiseToRupees(dev.ratePaise) : 150));
  const [controllers, setControllers] = useState(() => String(dev?.controllers ?? 0));
  const [games, setGames] = useState((dev?.games ?? []).join(', '));

  const parsedRate = Number(rupees);
  const rateValid = rupees.trim() !== '' && Number.isFinite(parsedRate) && parsedRate >= 0;
  const valid = label.trim().length > 0 && rateValid;
  const busy = createM.isPending || patchM.isPending;
  const gamesArr = games.split(',').map((g) => g.trim()).filter(Boolean);
  const controllersNum = Math.max(0, Math.trunc(Number(controllers) || 0));

  const submit = () => {
    if (!valid) return;
    if (isEdit && dev) {
      const req: PatchDeviceReq = {
        label: label.trim(),
        spec: spec.trim(),
        ratePaise: rupeesToPaise(parsedRate),
        controllers: controllersNum,
        games: gamesArr,
      };
      patchM.mutate(
        { id: dev.id, req },
        {
          onSuccess: () => {
            notify(<><b>{label.trim()}</b> updated</>);
            onClose();
          },
          onError: (e) => notify(apiErr(e, 'Update failed')),
        },
      );
    } else {
      const req: CreateDeviceReq = {
        label: label.trim(),
        type,
        spec: spec.trim(),
        ratePaise: rupeesToPaise(parsedRate),
        controllers: controllersNum,
        games: gamesArr,
      };
      createM.mutate(req, {
        onSuccess: () => {
          notify(<><b>{label.trim()}</b> added</>);
          onClose();
        },
        onError: (e) => notify(apiErr(e, 'Create failed')),
      });
    }
  };

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
        {isEdit ? dev!.label : 'New device'}
      </div>
      <div
        className="mono"
        style={{ fontSize: 11, color: 'var(--faint)', letterSpacing: '.1em', marginTop: 6, textTransform: 'uppercase' }}
      >
        {isEdit ? 'Edit device' : 'Add a machine to the floor'}
      </div>
    </>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      header={header}
      footer={
        <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }} disabled={!valid || busy} onClick={submit}>
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add device'}
        </button>
      }
    >
      <div className="field" style={{ marginBottom: 16 }}>
        <span className="lab">Device name</span>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="RIG-17 / PS5-5" />
      </div>

      <div className="field" style={{ marginBottom: 16 }}>
        <span className="lab">Type</span>
        {isEdit ? (
          <div className="mono" style={{ color: 'var(--dim)', fontSize: 14, padding: '4px 0' }}>{type}</div>
        ) : (
          <div className="seg">
            {DEVICE_TYPES.map((t) => (
              <Chip key={t} on={type === t} dot onClick={() => setType(t)}>
                {t}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="field" style={{ marginBottom: 16 }}>
        <span className="lab">Spec</span>
        <input className="input" value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="RTX 4070 · i7" />
      </div>

      <div className="row" style={{ marginBottom: 16, gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <span className="lab">Rate (₹/hr)</span>
          <input className="input" type="number" min={0} step={10} value={rupees} onChange={(e) => setRupees(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <span className="lab">Controllers</span>
          <input
            className="input"
            type="number"
            min={0}
            value={controllers}
            onChange={(e) => setControllers(e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <span className="lab">Games (comma-separated)</span>
        <input
          className="input"
          value={games}
          onChange={(e) => setGames(e.target.value)}
          placeholder="Valorant, CS2, FIFA 24"
        />
        {gamesArr.length > 0 && (
          <div className="seg" style={{ marginTop: 10 }}>
            {gamesArr.map((g, i) => (
              <span key={g + i} className="chip" style={{ cursor: 'default' }}>
                {g}
              </span>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
