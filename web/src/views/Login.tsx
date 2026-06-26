// Login — design-language sign-in (dark/maroon, chamfered .card, Arenaze logo).
// Submits via AuthContext.login then navigates to the originally-requested page
// (or the floor). Shows an inline error on 401; "Forgot password?" hits the
// forgot-password endpoint and toasts the (always-200) result.
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Logo } from '../components/icons';
import { useToast } from '../components/Toast';
import { ApiError, forgotPassword } from '../api/client';

interface FromState {
  from?: { pathname?: string };
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { notify } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as FromState | null)?.from?.pathname ?? '/';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login({ username, password });
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid username or password.');
      } else {
        setError(err instanceof Error ? err.message : 'Sign-in failed. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    if (!username) {
      setError('Enter your username first, then tap “Forgot password?”.');
      return;
    }
    try {
      await forgotPassword({ username });
      notify(
        <>
          If <b>{username}</b> exists, a reset token was issued.
        </>,
      );
    } catch {
      notify(<>Could not start password reset.</>);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={onSubmit}>
        <div className="brand">
          <Logo className="logo" />
          <div className="wm">
            AREN<b>AZE</b>
          </div>
        </div>
        <h2>Operator Sign-in</h2>
        <div className="sub">Console access · Admin / Staff</div>

        <label className="field">
          <span className="lab">Username</span>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            placeholder="admin"
          />
        </label>
        <label className="field">
          <span className="lab">Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </label>

        {error && <div className="err">{error}</div>}

        <button
          className="btn primary"
          type="submit"
          disabled={busy}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {busy ? 'Signing in…' : 'Sign in →'}
        </button>
        <button type="button" className="forgot" onClick={onForgot}>
          Forgot password?
        </button>
      </form>
    </div>
  );
}
