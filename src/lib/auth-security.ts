import type { AuthError, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/**
 * Auth hardening helpers shared by the sign-in page, the auth provider, the
 * recovery flow and the admin console.
 *
 * New database objects (hardware_bans table + RPCs) are reached through a
 * narrow untyped bridge here so this file does not depend on regenerated
 * Supabase types.
 */

const AUTH_NOTICE_KEY = "zchat:auth_notice";
const NOTIFY_PENDING_KEY = "zchat:notify_optin_pending";

// --------------------------------------------------------------- errors ----

/** Turns GoTrue error codes (and legacy message text) into a clear sentence. */
export function friendlyAuthError(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return "Email or password is incorrect.";
    case "email_not_confirmed":
      return "Please confirm your email first — check your inbox for the confirmation link.";
    case "user_banned":
      return "This account is banned. If you think this is a mistake, sign in to file an appeal.";
    case "user_already_exists":
    case "email_exists":
      return "An account with that email already exists. Try logging in instead.";
    case "weak_password":
      return (
        error.message ||
        "That password is too weak. Use at least 8 characters, with letters and numbers."
      );
    case "over_email_send_rate_limit":
      return "Too many signup emails were sent just now, so the email can't go out yet. Wait a few minutes and try again — or create the account with Google instead.";
    case "over_request_rate_limit":
      return "Too many attempts. Please wait a minute and try again.";
    case "signup_disabled":
      return "Sign-ups are temporarily closed. Please try again later.";
    case "email_provider_disabled":
      return "Email sign-in is temporarily unavailable. Try Google instead.";
    case "email_address_not_authorized":
      return "Our email service can't send to that address yet. Please use Google sign-in, or try again a little later.";
    case "captcha_failed":
      return "The verification check failed. Refresh the page and try again.";
    case "otp_expired":
    case "token_expired":
      return "That code has expired. Request a new one and try again.";
    case "session_not_found":
    case "session_expired":
      return "Your reset session has expired. Request a new code and try again.";
    case "same_password":
      return "Your new password must be different from your current password.";
    case "email_address_invalid":
      return "That email address isn't accepted. Double-check it and try again.";
    case "request_timeout":
    case "unexpected_failure":
      return "Something went wrong on our side. Please try again in a moment.";
    default:
      break;
  }

  const message = error.message ?? "";
  const lower = message.toLowerCase();
  if (lower.includes("invalid login")) return "Email or password is incorrect.";
  if (lower.includes("already registered") || lower.includes("already exists")) {
    return "An account with that email already exists. Try logging in instead.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email first — check your inbox for the confirmation link.";
  }
  if (lower.includes("rate") || lower.includes("too many")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (lower.includes("password should")) return message;
  if (lower.includes("auth session missing")) {
    return "Your reset session is missing or has expired. Request a new code and try again.";
  }
  return message || "Something went wrong. Please try again.";
}

/** Auth errors that the user can resolve by resending the confirmation email. */
export function needsEmailConfirmation(error: AuthError): boolean {
  return (
    error.code === "email_not_confirmed" ||
    error.message.toLowerCase().includes("email not confirmed")
  );
}

/** OAuth/email-link errors arrive in the URL; turn them into a clear sentence. */
export function friendlyRedirectError(code: string, description: string): string {
  const lowerCode = code.toLowerCase();
  const lowerDescription = description.toLowerCase();
  if (lowerCode.includes("access_denied") || lowerDescription.includes("cancel")) {
    return "Google sign-in was cancelled.";
  }
  if (lowerCode.includes("otp_expired") || lowerDescription.includes("expired")) {
    return "That email link has expired. Request a new one and try again.";
  }
  if (lowerCode.includes("bad_oauth") || lowerCode.includes("flow_state")) {
    return "The sign-in session expired. Please try again.";
  }
  return description || "Sign-in didn't complete. Please try again.";
}

export type AuthRedirectError = { code: string; description: string };

/** Reads error=… / error_code=… from the query string and hash fragment. */
export function extractAuthRedirectError(): AuthRedirectError | null {
  if (typeof window === "undefined") return null;
  const search = new URLSearchParams(window.location.search);
  const hashRaw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hash = new URLSearchParams(hashRaw);
  const code =
    search.get("error_code") ?? hash.get("error_code") ?? search.get("error") ?? hash.get("error");
  if (!code) return null;
  const description = search.get("error_description") ?? hash.get("error_description") ?? "";
  return { code, description: description.replace(/\+/g, " ") };
}

/** Removes OAuth error params from the address bar (keeps real auth tokens). */
export function clearAuthRedirectError(): void {
  if (typeof window === "undefined") return;
  if (window.location.hash.includes("access_token")) return;
  try {
    const url = new URL(window.location.href);
    for (const key of ["error", "error_code", "error_description"]) {
      url.searchParams.delete(key);
    }
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------- notices ---

/** A message shown on the sign-in page after a cross-redirect sign-out. */
export function setAuthNotice(message: string): void {
  try {
    window.sessionStorage.setItem(AUTH_NOTICE_KEY, message);
  } catch {
    /* ignore */
  }
}

export function consumeAuthNotice(): string | null {
  try {
    const message = window.sessionStorage.getItem(AUTH_NOTICE_KEY);
    if (message) window.sessionStorage.removeItem(AUTH_NOTICE_KEY);
    return message;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------- hardware bans --

export type HardwareBanCheck = {
  banned: boolean;
  reason?: string;
  banned_at?: string;
};

type RpcResult = { data: unknown; error: { message: string } | null };
type UntypedRpc = (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;

const untyped = supabase as unknown as { rpc: UntypedRpc; from: unknown };

/** Pre-login check. Safe to call while signed out; never throws. */
export async function checkHardwareBan(
  fingerprint: string | null | undefined,
): Promise<HardwareBanCheck> {
  if (!fingerprint) return { banned: false };
  try {
    const { data, error } = await untyped.rpc("check_hardware_ban", {
      p_fingerprint: fingerprint,
    });
    if (error) return { banned: false };
    if (data && typeof data === "object" && "banned" in (data as Record<string, unknown>)) {
      return data as HardwareBanCheck;
    }
  } catch {
    /* never block sign-in on a failed check */
  }
  return { banned: false };
}

/**
 * After a successful sign-in: if the signed-in profile is banned, record this
 * device's fingerprint in hardware_bans so every future login/signup from it
 * is rejected. No-op for normal accounts.
 */
export async function registerBannedDeviceLogin(
  fingerprint: string | null | undefined,
): Promise<boolean> {
  if (!fingerprint) return false;
  try {
    const { data, error } = await untyped.rpc("register_banned_device_login", {
      p_fingerprint: fingerprint,
    });
    if (error) return false;
    return Boolean(
      data &&
      typeof data === "object" &&
      (data as { banned_device?: boolean }).banned_device === true,
    );
  } catch {
    return false;
  }
}

export type HardwareBanRow = {
  id: string;
  fingerprint: string;
  reason: string;
  source: string;
  user_id: string | null;
  active: boolean;
  created_at: string;
  unbanned_at: string | null;
};

type ListResult<T> = { data: T | null; error: { message: string } | null };
type UntypedListQuery = {
  select(columns: string): {
    order(column: string, options: { ascending: boolean }): Promise<ListResult<HardwareBanRow[]>>;
  };
};

/** Admin-only (enforced by RLS): every hardware ban, newest first. */
export async function fetchHardwareBans(): Promise<HardwareBanRow[]> {
  const from = untyped.from as (table: string) => UntypedListQuery;
  const { data, error } = await from("hardware_bans")
    .select("id, fingerprint, reason, source, user_id, active, created_at, unbanned_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Admin-only (enforced in the database): lift a device ban. */
export async function adminUnbanHardware(id: string): Promise<void> {
  const { error } = await untyped.rpc("admin_unban_hardware", { _id: id });
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------- notification opt-in

export type NotificationPermissionResult = NotificationPermission | "unsupported";

export function notificationPermissionSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Must be called from a user gesture (tap/click). Never throws. */
export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  if (!notificationPermissionSupported()) return "unsupported";
  try {
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    return await Notification.requestPermission();
  } catch {
    return "unsupported";
  }
}

/** Set before a Google redirect so the callback can persist consent. */
export function markNotifyOptinPending(): void {
  try {
    window.localStorage.setItem(NOTIFY_PENDING_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function readNotifyOptinPending(): boolean {
  try {
    return window.localStorage.getItem(NOTIFY_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearNotifyOptinPending(): void {
  try {
    window.localStorage.removeItem(NOTIFY_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** Persists the consent flag on the signed-in profile (idempotent). */
export async function persistNotifyOptin(value: boolean): Promise<void> {
  try {
    await untyped.rpc("set_notify_optin", { _value: value });
  } catch {
    /* best effort — the flag is also in user metadata */
  }
}

/**
 * After any sign-in: if consent was recorded during signup (user metadata or
 * the pre-Google-redirect marker), mirror it onto the profile row.
 */
export async function syncNotifyOptin(user: User | null | undefined): Promise<void> {
  if (!user) return;
  const pending = readNotifyOptinPending();
  const fromMetadata = user.user_metadata?.["notify_optin"] === true;
  if (pending || fromMetadata) {
    await persistNotifyOptin(true);
    clearNotifyOptinPending();
  }
}
