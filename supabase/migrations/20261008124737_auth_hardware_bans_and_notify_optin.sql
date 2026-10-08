-- Auth robustness: approval default, hardware bans, notification opt-in.
--
-- 1. Every new account (email, Google, any provider) must be reviewed:
--    application_status default becomes 'pending' as defence in depth.
-- 2. Notification consent flag stored on the profile (notify_optin).
-- 3. hardware_bans: banned device fingerprints with admin visibility/unban.
--    - handle_new_user() checks it on every signup (server-side).
--    - check_hardware_ban() runs before login (callable signed out).
--    - register_banned_device_login() records the device when a banned
--      account signs in, so that device is banned for every future attempt.
-- 4. Fix: guard_profile_columns() silently reverted device_fingerprint
--    updates made by SECURITY DEFINER helpers, so the legacy-account
--    fingerprint backfill never worked. The guard now allows those helpers
--    to opt out for the current transaction only.

-- ---------------------------------------------------------------- 1 & 2 ---
alter table public.profiles alter column application_status set default 'pending';

alter table public.profiles add column if not exists notify_optin boolean not null default false;

-- ------------------------------------------------------------------- 3 ----
create table if not exists public.hardware_bans (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  reason text not null default '',
  source text not null default 'manual',
  user_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unbanned_at timestamptz,
  unbanned_by uuid references auth.users(id) on delete set null
);

create unique index if not exists hardware_bans_fingerprint_idx
  on public.hardware_bans (fingerprint);
create index if not exists hardware_bans_active_idx
  on public.hardware_bans (active);

alter table public.hardware_bans enable row level security;

revoke all on public.hardware_bans from anon, authenticated;
grant select on public.hardware_bans to authenticated;
grant all on public.hardware_bans to service_role;

drop policy if exists hardware_bans_admin_select on public.hardware_bans;
create policy hardware_bans_admin_select on public.hardware_bans
  for select to authenticated
  using (private.is_admin(auth.uid()));

-- ------------------------------------------------------------------- 4 ----
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- SECURITY DEFINER helpers (device-fingerprint backfill / hardware-ban
  -- recording) opt out for the current transaction only.
  if coalesce(current_setting('zchat.bypass_profile_guard', true), '') = 'on' then
    return new;
  end if;

  if private.is_admin(auth.uid()) then
    return new;
  end if;

  new.is_admin := old.is_admin;
  new.banned := old.banned;
  new.device_fingerprint := old.device_fingerprint;
  new.timeout_until := old.timeout_until;
  new.timeout_reason := old.timeout_reason;
  new.moderation_strikes := old.moderation_strikes;
  new.last_strike_at := old.last_strike_at;
  new.application_status := old.application_status;
  new.r6_profile := old.r6_profile;

  if new.username is distinct from old.username then
    if old.username_changed_at is not null and old.username_changed_at > now() - interval '14 days' then
      raise exception 'username can only be changed once every 2 weeks';
    end if;
    new.username := lower(regexp_replace(coalesce(new.username, ''), '[^a-zA-Z0-9_]', '', 'g'));
    if length(new.username) < 3 or length(new.username) > 20 then
      raise exception 'username must be 3-20 characters (letters, numbers, underscore)';
    end if;
    new.username_changed_at := now();
  end if;

  if length(coalesce(new.bio, '')) > 300 then
    new.bio := left(new.bio, 300);
  end if;

  return new;
end;
$$;

create or replace function public.backfill_device_fingerprint(p_fingerprint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{16,128}$' then
    return;
  end if;
  perform set_config('zchat.bypass_profile_guard', 'on', true);
  update public.profiles
  set device_fingerprint = p_fingerprint
  where id = auth.uid() and device_fingerprint is null;
end;
$$;
revoke all on function public.backfill_device_fingerprint(text) from public, anon;
grant execute on function public.backfill_device_fingerprint(text) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _fingerprint text := new.raw_user_meta_data ->> 'device_fingerprint';
  _auto_ban boolean := false;
  _notify boolean := lower(coalesce(new.raw_user_meta_data ->> 'notify_optin', 'false')) in ('true', 't', '1', 'yes', 'on');
  _username text := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[^a-zA-Z0-9_]', '', 'g'));
  _base text;
  _candidate text;
  _n int := 1;
begin
  if _fingerprint is not null then
    select exists (
      select 1 from public.profiles where device_fingerprint = _fingerprint and banned = true
    ) or exists (
      select 1 from public.hardware_bans where fingerprint = _fingerprint and active = true
    ) into _auto_ban;
  end if;

  if length(_username) < 3 then
    _base := lower(regexp_replace(
      coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1), 'user'),
      '[^a-zA-Z0-9_]', '', 'g'));
    if length(_base) < 3 then
      _base := 'user' || substr(replace(new.id::text, '-', ''), 1, 6);
    end if;
    _username := substr(_base, 1, 16);
  end if;
  _candidate := _username;
  while exists (select 1 from public.profiles where lower(username) = _candidate) loop
    _candidate := substr(_username, 1, 16) || _n::text;
    _n := _n + 1;
  end loop;

  insert into public.profiles (id, display_name, username, device_fingerprint, banned, application_status, notify_optin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    _candidate,
    _fingerprint,
    _auto_ban,
    'pending',
    _notify
  )
  on conflict (id) do nothing;

  -- A signup from an already-banned device is itself banned and the device
  -- joins the hardware-ban list, so the next attempt is rejected outright.
  if _auto_ban and _fingerprint is not null then
    insert into public.hardware_bans (fingerprint, reason, source, user_id)
    values (_fingerprint, 'Signup from a banned device', 'banned_signup', new.id)
    on conflict (fingerprint) do update
      set active = true, updated_at = now()
      where public.hardware_bans.active = false;
  end if;

  return new;
end;
$$;

-- Pre-login check: callable signed out, returns {"banned": false} or
-- {"banned": true, "reason": ..., "banned_at": ...}.
create or replace function public.check_hardware_ban(p_fingerprint text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'banned', true,
        'reason', b.reason,
        'banned_at', b.created_at
      )
      from public.hardware_bans b
      where b.active and b.fingerprint = p_fingerprint
      limit 1
    ),
    jsonb_build_object('banned', false)
  );
$$;
revoke all on function public.check_hardware_ban(text) from public;
grant execute on function public.check_hardware_ban(text) to anon, authenticated;

-- Called by the app right after a banned account signs in. Adds this device
-- to the hardware-ban list (and records it on the profile if missing).
create or replace function public.register_banned_device_login(p_fingerprint text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _banned boolean := false;
begin
  if _uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{16,128}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_fingerprint');
  end if;

  select coalesce(banned, false) into _banned from public.profiles where id = _uid;
  if not _banned then
    return jsonb_build_object('ok', true, 'banned_device', false);
  end if;

  perform set_config('zchat.bypass_profile_guard', 'on', true);
  update public.profiles
  set device_fingerprint = p_fingerprint
  where id = _uid and device_fingerprint is null;

  insert into public.hardware_bans (fingerprint, reason, source, user_id)
  values (p_fingerprint, 'Banned account signed in on this device', 'banned_login', _uid)
  on conflict (fingerprint) do update
    set active = true, updated_at = now(), user_id = excluded.user_id, reason = excluded.reason
    where public.hardware_bans.active = false;

  return jsonb_build_object('ok', true, 'banned_device', true);
end;
$$;
revoke all on function public.register_banned_device_login(text) from public, anon;
grant execute on function public.register_banned_device_login(text) to authenticated;

-- Notification consent recorded from the signup flow (idempotent).
create or replace function public.set_notify_optin(_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.profiles
  set notify_optin = coalesce(_value, false), updated_at = now()
  where id = auth.uid();
end;
$$;
revoke all on function public.set_notify_optin(boolean) from public, anon;
grant execute on function public.set_notify_optin(boolean) to authenticated;

-- Admin: unban a device fingerprint.
create or replace function public.admin_unban_hardware(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;
  update public.hardware_bans
  set active = false, unbanned_at = now(), unbanned_by = auth.uid(), updated_at = now()
  where id = _id;
end;
$$;
revoke all on function public.admin_unban_hardware(uuid) from public, anon;
grant execute on function public.admin_unban_hardware(uuid) to authenticated;

-- Banning an account also bans its known device fingerprint; unbanning lifts
-- the active hardware bans created for that account.
create or replace function public.admin_set_banned(_target uuid, _value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _fp text;
begin
  if not private.is_admin(auth.uid()) then raise exception 'not authorized'; end if;
  if _target = auth.uid() then raise exception 'cannot ban yourself'; end if;

  update public.profiles set banned = _value where id = _target;

  if _value then
    select device_fingerprint into _fp from public.profiles where id = _target;
    if _fp is not null and _fp ~ '^[0-9a-f]{16,128}$' then
      insert into public.hardware_bans (fingerprint, reason, source, user_id, created_by)
      values (_fp, 'Account banned by an admin', 'admin_ban', _target, auth.uid())
      on conflict (fingerprint) do update
        set active = true,
            updated_at = now(),
            user_id = excluded.user_id,
            reason = excluded.reason,
            created_by = excluded.created_by
        where public.hardware_bans.active = false or public.hardware_bans.source = 'admin_ban';
    end if;
  else
    update public.hardware_bans
    set active = false, updated_at = now(), unbanned_at = now(), unbanned_by = auth.uid()
    where user_id = _target and active;
  end if;
end;
$$;
revoke all on function public.admin_set_banned(uuid, boolean) from public, anon;
grant execute on function public.admin_set_banned(uuid, boolean) to authenticated;
