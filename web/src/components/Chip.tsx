// Toggle chip — ported from the design's `.chip`. Used for filters / segmented
// pickers (platform, duration, guests). Selected => maroon outline + red dot.
import type { ReactNode } from 'react';

export function Chip({
  on,
  dot,
  onClick,
  children,
}: {
  on?: boolean;
  /** Show the leading status dot (filter chips). */
  dot?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={'chip' + (on ? ' on' : '')} onClick={onClick}>
      {dot && <span className="dot" />}
      {children}
    </button>
  );
}
