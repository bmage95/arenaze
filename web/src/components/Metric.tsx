// Metric card — ported from gg-app.jsx <Metric>.
//   k=label, v=value, unit=trailing <small>, pre=leading glyph (e.g. ₹),
//   sub=footnote, subc='up' | 'down' for the colored delta.
import type { ReactNode } from 'react';

export function Metric({
  k,
  v,
  unit,
  pre,
  sub,
  subc,
}: {
  k: ReactNode;
  v: ReactNode;
  unit?: ReactNode;
  pre?: ReactNode;
  sub?: ReactNode;
  subc?: 'up' | 'down' | '';
}) {
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className="v">
        {pre}
        {v}
        {unit && <small>{unit}</small>}
      </div>
      {sub && <div className={'sub ' + (subc ?? '')}>{sub}</div>}
    </div>
  );
}
