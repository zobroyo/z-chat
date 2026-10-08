import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { getDeviceFingerprint } from "@/lib/fingerprint";
import {
  checkHardwareBan,
  registerBannedDeviceLogin,
  setAuthNotice,
  syncNotifyOptin,
} from "@/lib/auth-security";

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState>({ session: null, user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id ?? null;
  const user = session?.user ?? null;

  // Runs once per signed-in user, on any sign-in path (password, Google
  // redirect, email link). Enforces hardware bans and mirrors choices made
  // during signup onto the profile row.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    void (async () => {
      const fingerprint = await getDeviceFingerprint();
      if (cancelled || !fingerprint) return;

      const ban = await checkHardwareBan(fingerprint);
      if (cancelled) return;
      if (ban.banned) {
        setAuthNotice(
          "This device has been banned from ZChat, so signing in isn't possible here. If you think this is a mistake, contact support.",
        );
        await supabase.auth.signOut();
        return;
      }

      // No-op unless the signed-in profile is banned; if it is, this device
      // joins the hardware-ban list immediately.
      await registerBannedDeviceLogin(fingerprint);
      if (!cancelled) await syncNotifyOptin(user);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <AuthContext.Provider value={{ session, user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
