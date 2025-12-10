import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { request } from "../lib/api";

const AuthContext = createContext(null);
const TOKEN_KEY = "smartpark_token";
const REFRESH_KEY = "smartpark_refresh";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [refreshToken, setRefreshToken] = useState(() => localStorage.getItem(REFRESH_KEY));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(token) || Boolean(refreshToken));
  const [error, setError] = useState(null);
  const refreshPromiseRef = useRef(null);

  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (refreshToken) {
      localStorage.setItem(REFRESH_KEY, refreshToken);
    } else {
      localStorage.removeItem(REFRESH_KEY);
    }
  }, [refreshToken]);

  const clearSession = useCallback(() => {
    setToken(null);
    setRefreshToken(null);
    setUser(null);
    setError(null);
  }, []);

  const refreshAccessToken = useCallback(async () => {
    if (!refreshToken) {
      throw new Error("Session expired");
    }
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = request("/auth/refresh", {
        method: "POST",
        body: { refresh_token: refreshToken },
      })
        .then((data) => {
          setToken(data.access_token);
          setRefreshToken(data.refresh_token);
          setUser(data.user);
          setError(null);
          return data.access_token;
        })
        .catch((err) => {
          clearSession();
          throw err;
        })
        .finally(() => {
          refreshPromiseRef.current = null;
        });
    }
    return refreshPromiseRef.current;
  }, [refreshToken, clearSession]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      if (!token) {
        if (refreshToken) {
          try {
            await refreshAccessToken();
          } catch (err) {
            if (!cancelled) {
              setError(err.message);
            }
          } finally {
            if (!cancelled) setLoading(false);
          }
        } else {
          if (!cancelled) {
            setUser(null);
            setLoading(false);
          }
        }
        return;
      }

      setLoading(true);
      try {
        const profile = await request("/auth/me", { token });
        if (!cancelled) {
          setUser(profile);
          setError(null);
        }
      } catch (err) {
        if (err.status === 401 && refreshToken) {
          try {
            await refreshAccessToken();
            return;
          } catch (refreshErr) {
            if (!cancelled) {
              setError(refreshErr.message);
            }
          }
        } else if (!cancelled) {
          setError(err.message);
        }
        clearSession();
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [token, refreshToken, refreshAccessToken, clearSession]);

  const login = useCallback(
    async (email, password) => {
      setError(null);
      const data = await request("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setToken(data.access_token);
      setRefreshToken(data.refresh_token);
      setUser(data.user);
      return data.user;
    },
    []
  );

  const register = useCallback(
    async (name, email, password) => {
      setError(null);
      const data = await request("/auth/register", {
        method: "POST",
        body: { name, email, password },
      });
      setToken(data.access_token);
      setRefreshToken(data.refresh_token);
      setUser(data.user);
      return data.user;
    },
    []
  );

  const logout = useCallback(async () => {
    if (refreshToken) {
      try {
        await request("/auth/logout", {
          method: "POST",
          body: { refresh_token: refreshToken },
        });
      } catch (err) {
        console.warn("Failed to revoke session", err);
      }
    }
    clearSession();
  }, [refreshToken, clearSession]);

  const ensureAccessToken = useCallback(async () => {
    if (token) return token;
    return refreshAccessToken();
  }, [token, refreshAccessToken]);

  const authorizedRequest = useCallback(
    async (path, options = {}) => {
      const attempt = async (activeToken) => request(path, { ...options, token: activeToken });
      let activeToken = token;
      if (!activeToken) {
        activeToken = await ensureAccessToken();
      }
      try {
        return await attempt(activeToken);
      } catch (err) {
        if (err.status === 401 && refreshToken) {
          const newToken = await refreshAccessToken();
          return attempt(newToken);
        }
        throw err;
      }
    },
    [token, refreshToken, ensureAccessToken, refreshAccessToken]
  );

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      error,
      login,
      register,
      logout,
      setError,
      authorizedRequest,
      refreshAccessToken,
    }),
    [
      user,
      token,
      loading,
      error,
      login,
      register,
      logout,
      authorizedRequest,
      refreshAccessToken,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

