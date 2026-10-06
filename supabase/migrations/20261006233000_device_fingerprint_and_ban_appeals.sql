-- Device fingerprints + ban appeals.
--
-- NOTE: this exact feature was already applied manually to the hosted project;
-- the statements below are written to be idempotent so re-running is safe.
--
-- Anti-evasion design: no IP addresses are used (many legitimate users share
-- one IP). Instead, signup captures a browser/device fingerprint and
-- handle_new_user() auto-bans any new account whose fingerprint matches an
-- already-banned profile.

-- 1. Device fingerprint, captured at signup, used to auto-ban repeat signups
-- from the same browser.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
REVOKE UPDATE (device_fingerprint) ON public.profiles FROM authenticated;
CREATE INDEX IF NOT EXISTS profiles_device_fingerprint_idx ON public.profiles(device_fingerprint);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _fingerprint TEXT := NEW.raw_user_meta_data ->> 'device_fingerprint';
  _auto_ban BOOLEAN := false;
BEGIN
  IF _fingerprint IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles WHERE device_fingerprint = _fingerprint AND banned = true
    ) INTO _auto_ban;
  END IF;

  INSERT INTO public.profiles (id, display_name, device_fingerprint, banned)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    _fingerprint,
    _auto_ban
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 1b. Backfill for accounts created before fingerprinting existed: a banned
-- legacy account only has to sign in once (e.g. to file an appeal) for its
-- fingerprint to be recorded, which arms the auto-ban check above.
CREATE OR REPLACE FUNCTION public.backfill_device_fingerprint(p_fingerprint TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_fingerprint IS NULL OR length(p_fingerprint) < 8 THEN
    RETURN;
  END IF;
  UPDATE public.profiles
  SET device_fingerprint = p_fingerprint
  WHERE id = auth.uid() AND device_fingerprint IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.backfill_device_fingerprint(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_device_fingerprint(TEXT) TO authenticated;

-- 2. Ban appeals — work even while banned, since this is the one channel
-- that must stay open regardless of ban status.
CREATE TABLE IF NOT EXISTS public.banned_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.banned_appeals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "banned_appeals_insert_own" ON public.banned_appeals;
CREATE POLICY "banned_appeals_insert_own" ON public.banned_appeals FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "banned_appeals_select_own_or_admin" ON public.banned_appeals;
CREATE POLICY "banned_appeals_select_own_or_admin" ON public.banned_appeals FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "banned_appeals_update_admin" ON public.banned_appeals;
CREATE POLICY "banned_appeals_update_admin" ON public.banned_appeals FOR UPDATE TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
