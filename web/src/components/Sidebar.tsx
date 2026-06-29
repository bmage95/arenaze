// Sidebar rail — ported from gg-app.jsx `.side`. Arenaze logo + icon nav with
// active state and hover `.tip`. Admin-only items (Analytics, Pricing) are
// hidden for staff. Logout sits at the bottom; the logged-in user's name shows
// in its hover tip.
import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactElement, SVGProps } from 'react';
import { I, Logo } from './icons';
import { useAuth } from '../auth/AuthContext';

interface NavItem {
  to: string;
  label: string;
  Icon: (p: SVGProps<SVGSVGElement>) => ReactElement;
  admin?: boolean;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Floor', Icon: I.floor, end: true },
  { to: '/ledger', label: 'Bookings', Icon: I.res },
  { to: '/customers', label: 'Customers', Icon: I.mem },
  { to: '/devices', label: 'Device Manager', Icon: I.dev, admin: true },
  { to: '/analytics', label: 'Analytics', Icon: I.ana, admin: true },
  { to: '/pricing', label: 'Pricing', Icon: I.price, admin: true },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = NAV.filter((n) => !n.admin || user?.role === 'admin');

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <nav className="side">
      <Logo className="logo" />
      <div className="nav">
        {items.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => 'navbtn' + (isActive ? ' on' : '')}
          >
            <Icon />
            <span className="tip">{label}</span>
          </NavLink>
        ))}
      </div>
      <button className="navbtn" onClick={handleLogout} aria-label="Log out">
        <I.logout />
        <span className="tip">{user ? `Logout · ${user.displayName}` : 'Logout'}</span>
      </button>
    </nav>
  );
}
