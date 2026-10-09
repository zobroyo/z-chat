-- Stripe billing: plan fields on profiles, a private write-only secret slot for
-- the webhook sync key, and the three SECURITY DEFINER RPCs used by the server
-- and the one-shot setup command. Applied to the cloud project on 2026-10-09.

alter table public.profiles
  add column if not exists plan text not null default 'free',
  add column if not exists plan_status text,
  add column if not exists stripe_customer_id text,
  add column if not exists plan_renews_at timestamp with time zone;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_plan_check'
  ) then
    alter table public.profiles
      add constraint profiles_plan_check check (plan in ('free', 'pro', 'max'));
  end if;
end $$;

create table if not exists private.server_secrets (
  key text primary key,
  value text not null
);

revoke all on private.server_secrets from public, anon, authenticated;

create or replace function public.stripe_init_sync_key(_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _key is null or length(_key) < 16 then
    raise exception 'bad key';
  end if;
  insert into private.server_secrets(key, value)
  values ('stripe_sync', _key)
  on conflict (key) do nothing;
end $$;

create or replace function public.stripe_set_customer(_key text, _user uuid, _customer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.server_secrets where key = 'stripe_sync' and value = _key) then
    raise exception 'not authorized';
  end if;
  update public.profiles set stripe_customer_id = _customer where id = _user;
end $$;

create or replace function public.stripe_sync_plan(_key text, _user uuid, _plan text, _status text, _customer text, _renews timestamp with time zone)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.server_secrets where key = 'stripe_sync' and value = _key) then
    raise exception 'not authorized';
  end if;
  if _plan not in ('free', 'pro', 'max') then
    raise exception 'bad plan';
  end if;
  update public.profiles
     set plan = _plan,
         plan_status = nullif(_status, ''),
         stripe_customer_id = coalesce(nullif(_customer, ''), stripe_customer_id),
         plan_renews_at = _renews
   where id = _user;
end $$;

revoke all on function public.stripe_init_sync_key(text) from public;
revoke all on function public.stripe_set_customer(text, uuid, text) from public;
revoke all on function public.stripe_sync_plan(text, uuid, text, text, text, timestamp with time zone) from public;
grant execute on function public.stripe_init_sync_key(text) to anon, authenticated;
grant execute on function public.stripe_set_customer(text, uuid, text) to anon, authenticated;
grant execute on function public.stripe_sync_plan(text, uuid, text, text, text, timestamp with time zone) to anon, authenticated;

create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
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
  new.plan := old.plan;
  new.plan_status := old.plan_status;
  new.stripe_customer_id := old.stripe_customer_id;
  new.plan_renews_at := old.plan_renews_at;

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
$function$;
