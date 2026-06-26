// Status pill — ported from gg-app.jsx <Pill>. kind drives color.
import type { ReactNode } from 'react';

export type PillKind = 'ok' | 'warn' | 'busy' | 'off';

export function Pill({ kind, children }: { kind: PillKind; children: ReactNode }) {
  return (
    <span className={'pill ' + kind}>
      <span className="d" />
      {children}
    </span>
  );
}
