// Centered modal — ported from the design's `.modal` + `.card`. Clicking the
// scrim calls onClose; compose your own header/X inside `children`.
import type { CSSProperties, ReactNode } from 'react';

export function Modal({
  open,
  onClose,
  children,
  width,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Override the default 440px card width. */
  width?: CSSProperties['width'];
}) {
  if (!open) return null;
  return (
    <div className="modal">
      <div className="scrim" onClick={onClose} />
      <div className="card" style={{ position: 'relative', zIndex: 1, ...(width ? { width } : null) }}>
        {children}
      </div>
    </div>
  );
}
