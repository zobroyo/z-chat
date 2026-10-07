/*
 * Guest call support.
 *
 * Guests open a shared /call/<conversationId>?k=<guestKey> link. They get an
 * isolated Supabase client whose session is memory-only (`persistSession:
 * false`), so:
 *  - the guest can never leak into /chat (the main app client stays signed
 *    out in the same browser),
 *  - the guest code only ever subscribes to the one Realtime channel for the
 *    invited call — no tables, no storage, no auth beyond the optional
 *    anonymous sign-in.
 *
 * Preferred path is Supabase anonymous sign-in. If the project has anonymous
 * sign-ins disabled, Realtime still works with the publishable key (the same
 * key every browser already has), so guests can join without a session.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

export function createCallGuestClient(): SupabaseClient | null {
  const url = import.meta.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"];
  const key =
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;

  try {
    return createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(
            typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
          );
          if (init?.headers) {
            new Headers(init.headers).forEach((value, name) => headers.set(name, value));
          }
          if (isNewSupabaseApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
            headers.delete("Authorization");
          }
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
    });
  } catch {
    return null;
  }
}

/** Friendly throwaway display name, e.g. "Guest-1234". */
export function randomGuestName(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `Guest-${digits}`;
}

/**
 * Stable-enough identity used when anonymous sign-in is unavailable. Prefixed
 * so it can never collide with a real profile id.
 */
export function randomLocalGuestId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `guest-${random}`;
}
