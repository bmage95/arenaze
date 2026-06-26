// Pricing (admin) — per-device-type hourly rates. Edit a rate in rupees; saving
// converts to integer paise and PATCHes the rule, which cascades the rate to all
// devices of that type (the floor is auto-invalidated by the hook).
import { useState } from 'react';
import {
  type PricingRuleDTO,
  formatPaise,
  paiseToRupees,
  rupeesToPaise,
} from '@arenaze/shared';
import { usePricing, useUpdatePricing, useDevices } from '../api/queries';
import { ApiError } from '../api/client';
import { useToast } from '../components/Toast';

function apiErr(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function Pricing() {
  const pricingQ = usePricing();
  const devicesQ = useDevices();

  const deviceCount = (type: string) =>
    devicesQ.data?.filter((d) => d.type === type).length ?? 0;

  if (pricingQ.isLoading) {
    return <div className="empty">Loading pricing…</div>;
  }
  if (pricingQ.isError) {
    const e = pricingQ.error;
    if (e instanceof ApiError && e.code === 'forbidden') {
      return <div className="empty">Admin access required</div>;
    }
    return <div className="empty">{apiErr(pricingQ.error, 'Failed to load pricing')}</div>;
  }

  const rules = pricingQ.data ?? [];

  return (
    <>
      <div className="shead">
        <div className="t">
          Pricing
          <span className="ct">{rules.length} DEVICE TYPES</span>
        </div>
      </div>

      <p className="lead">
        Hourly rate per device type, stored in paise. Updating a rate cascades to every device of
        that type and to all new sessions.
      </p>

      {rules.length === 0 ? (
        <div className="empty">No pricing rules</div>
      ) : (
        <div className="panel">
          <table className="tbl">
            <thead>
              <tr>
                <th>Device type</th>
                <th>Current rate</th>
                <th>New rate (₹/hr)</th>
                <th>Devices</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <PricingRow key={rule.id} rule={rule} devices={deviceCount(rule.deviceType)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PricingRow({ rule, devices }: { rule: PricingRuleDTO; devices: number }) {
  const { notify } = useToast();
  const updateM = useUpdatePricing();
  const [rupees, setRupees] = useState(() => String(paiseToRupees(rule.ratePaise)));

  const parsed = Number(rupees);
  const valid = rupees.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;
  const nextPaise = valid ? rupeesToPaise(parsed) : rule.ratePaise;
  const changed = valid && nextPaise !== rule.ratePaise;

  const save = () => {
    updateM.mutate(
      { id: rule.id, req: { ratePaise: nextPaise } },
      {
        onSuccess: (r) => {
          setRupees(String(paiseToRupees(r.ratePaise)));
          notify(
            <>
              {r.deviceType} rate updated to <b>{formatPaise(r.ratePaise)}</b>/hr · cascaded to{' '}
              {devices} device{devices === 1 ? '' : 's'}
            </>,
          );
        },
        onError: (e) =>
          notify(
            e instanceof ApiError && e.code === 'forbidden' ? 'Admins only' : apiErr(e, 'Update failed'),
          ),
      },
    );
  };

  return (
    <tr>
      <td>
        <b>{rule.deviceType}</b>
      </td>
      <td className="mono">{formatPaise(rule.ratePaise)}/hr</td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ color: 'var(--faint)' }}>
            ₹
          </span>
          <input
            className="input"
            type="number"
            min={0}
            step={10}
            value={rupees}
            onChange={(e) => setRupees(e.target.value)}
            style={{ width: 120 }}
          />
          <span className="mono" style={{ color: 'var(--faint)' }}>
            /hr
          </span>
        </div>
      </td>
      <td className="mono">{devices}</td>
      <td>
        <button
          className="btn maroon sm"
          onClick={save}
          disabled={!changed || updateM.isPending}
        >
          {updateM.isPending ? 'Saving…' : 'Save'}
        </button>
      </td>
    </tr>
  );
}
