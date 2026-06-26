// Routes. /login is public; everything else is wrapped in <ProtectedRoute> then
// <AppLayout>. Each data view renders inside the shared layout (sidebar + topbar
// + scroll). Analytics + Pricing are additionally guarded by <RequireAdmin>.
import { Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './views/Login';
import { Floor } from './views/Floor';
import { Availability } from './views/Availability';
import { Ledger } from './views/Ledger';
import { Customers } from './views/Customers';
import { Analytics } from './views/Analytics';
import { Pricing } from './views/Pricing';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute, RequireAdmin } from './auth/ProtectedRoute';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Floor />} />
          <Route path="availability" element={<Availability />} />
          <Route path="ledger" element={<Ledger />} />
          <Route path="customers" element={<Customers />} />

          {/* admin-only */}
          <Route element={<RequireAdmin />}>
            <Route path="analytics" element={<Analytics />} />
            <Route path="pricing" element={<Pricing />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
