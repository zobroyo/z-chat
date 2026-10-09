-- Make stripe_init_sync_key report whether the caller's key is the active one.
-- The old void version silently no-opped on conflict, so a re-run of the
-- one-shot setup could generate a fresh key, believe it was stored, and then
-- fail every stripe_sync_plan / stripe_set_customer call with 'not authorized'.
-- Returning `value = _key` reveals only equality, never the stored secret.
-- Applied to the cloud project on 2026-10-09.

drop function if exists public.stripe_init_sync_key(text);

create function public.stripe_init_sync_key(_key text)
returns boolean
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
  return exists (
    select 1 from private.server_secrets
    where key = 'stripe_sync' and value = _key
  );
end $$;

revoke all on function public.stripe_init_sync_key(text) from public;
grant execute on function public.stripe_init_sync_key(text) to anon, authenticated;
