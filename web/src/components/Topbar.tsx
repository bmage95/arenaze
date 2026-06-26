// Topbar — ported from gg-app.jsx `.topbar`. Page title (derived from the
// route) + café crumb (tenantName) on the left; live/free status pills (from the
// dashboard tiles poll) + a ticking clock on the right.
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Pill } from './Pill';
import { useAuth } from '../auth/AuthContext';
import { useDashboardTiles } from '../api/queries';

const TITLES: Record<string, string> = {
  '/': 'Floor',
  '/ledger': 'Bookings',
  '/availability': 'Availability',
  '/customers': 'Customers',
  '/analytics': 'Analytics',
  '/pricing': 'Pricing',
};

function fmtClock(t: number): string {
  const d = new Date(t);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function Topbar() {
  const { user } = useAuth();
  const location = useLocation();
  const tiles = useDashboardTiles();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const title = TITLES[location.pathname] ?? 'Arenaze';
  const live = tiles.data?.activeCount ?? 0;
  const free = tiles.data?.freeCount ?? 0;

  return (
    <header className="topbar">
      <div className="left">
        <h1>{title}</h1>
        {user?.tenantName && <span className="crumb">{user.tenantName}</span>}
      </div>
      <div className="right">
        <Pill kind="busy">{live} live</Pill>
        <Pill kind="ok">{free} free</Pill>
        <span className="clock mono">{fmtClock(now)}</span>
      </div>
    </header>
  );
}
