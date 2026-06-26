// All money in the system is INTEGER PAISE (1 rupee = 100 paise). Never floats.

export type Paise = number;

export const rupeesToPaise = (rupees: number): Paise => Math.round(rupees * 100);
export const paiseToRupees = (paise: Paise): number => paise / 100;

/** "₹1,234" — or compact "₹1.2k" when opts.compact and >= 1000. */
export function formatPaise(paise: Paise, opts?: { compact?: boolean }): string {
  const rupees = paise / 100;
  if (opts?.compact && Math.abs(rupees) >= 1000) {
    const k = rupees / 1000;
    return '₹' + k.toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return '₹' + Math.round(rupees).toLocaleString('en-IN');
}

/**
 * Accrued bill, derived on read and finalized on session end.
 * elapsedSeconds × (paise/hour) ÷ 3600, rounded UP to whole paise.
 * Integer math end-to-end — no floats persisted.
 */
export function accruedPaise(elapsedSeconds: number, ratePaisePerHour: Paise): Paise {
  if (elapsedSeconds <= 0) return 0;
  return Math.ceil((elapsedSeconds * ratePaisePerHour) / 3600);
}

/** Quote for a planned session of `minutes` at an hourly paise rate. */
export function quotePaise(minutes: number, ratePaisePerHour: Paise): Paise {
  if (minutes <= 0) return 0;
  return Math.ceil((minutes * ratePaisePerHour) / 60);
}
