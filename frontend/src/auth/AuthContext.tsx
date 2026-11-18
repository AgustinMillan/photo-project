import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../lib/client.ts";
import { authApi } from "../lib/endpoints.ts";
import type { AuthUser } from "../lib/types.ts";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "authenticated"; user: AuthUser };

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<void>;
  logout: (allDevices?: boolean) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  useEffect(() => {
    let active = true;
    api.onSessionLost(() => setState({ status: "anonymous", user: null }));

    // The refresh cookie is HttpOnly, so the only way to know if a session exists is to try.
    api.refreshSession().then((session) => {
      if (!active) return;
      setState(
        session
          ? { status: "authenticated", user: session.user }
          : { status: "anonymous", user: null },
      );
    });

    return () => {
      active = false;
      api.onSessionLost(null);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await authApi.login({ email: email.trim(), password });
    api.setAccessToken(session.accessToken);
    setState({ status: "authenticated", user: session.user });
  }, []);

  const logout = useCallback(async (allDevices = false) => {
    try {
      await authApi.logout(allDevices);
    } finally {
      api.setAccessToken(null);
      setState({ status: "anonymous", user: null });
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }

  return value;
}
