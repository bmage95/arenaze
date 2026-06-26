// Auth context: holds the AuthUser, drives login/logout, hydrates from
// localStorage, and listens for the client's forced-logout signal (fired when a
// silent token refresh fails).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser, LoginReq } from '@arenaze/shared';
import * as api from '../api/client';

const USER_KEY = 'arenaze.user';

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (creds: LoginReq) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Only treat as authenticated if BOTH an access token and a stored user exist.
  const [user, setUser] = useState<AuthUser | null>(() =>
    api.getAccessToken() ? readStoredUser() : null,
  );

  const login = useCallback(async (creds: LoginReq) => {
    const res = await api.login(creds);
    api.setTokens(res.accessToken, res.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = api.getRefreshToken();
    if (refreshToken) {
      try {
        await api.logout({ refreshToken });
      } catch {
        // best-effort server revoke; tear down locally regardless
      }
    }
    api.clearTokens();
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  // Forced logout from the API client (refresh failed) → drop local session.
  useEffect(
    () =>
      api.onForcedLogout(() => {
        localStorage.removeItem(USER_KEY);
        setUser(null);
      }),
    [],
  );

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
