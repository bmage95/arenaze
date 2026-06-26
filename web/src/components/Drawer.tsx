// Right-side drawer — ported from the design's `.scrim` + `.drawer` with
// `.dh` (header) / `.db` (body) / `.df` (footer) slots. A close X is always
// rendered top-right; pass `header` for a rich title block or `title` for plain.
import type { ReactNode } from 'react';
import { I } from './icons';

export function Drawer({
  open,
  onClose,
  title,
  header,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        {(header || title) && (
          <div className="dh">
            <div>{header ?? title}</div>
            <button className="x" onClick={onClose} aria-label="Close">
              <I.x />
            </button>
          </div>
        )}
        <div className="db">{children}</div>
        {footer && <div className="df">{footer}</div>}
      </aside>
    </>
  );
}
