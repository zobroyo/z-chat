-- Plan-based quotas for Z Slides. The publishable key cannot read profiles
-- (RLS), so Z Slides reads a user's plan through these secret-keyed RPCs -
-- the same pattern as the Stripe sync key. slide_init_key is called once to
-- store the shared secret; slides_plan returns { plan, status } for a user.

create or replace function public.slides_init_key(_key text)
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
  values ('slides_quota', _key)
  on conflict (key) do nothing;
  return exists (
    select 1 from private.server_secrets where key = 'slides_quota' and value = _key
  );
end $$;

create or replace function public.slides_plan(_key text, _user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from private.server_secrets where key = 'slides_quota' and value = _key) then
    raise exception 'not authorized';
  end if;
  select jsonb_build_object('plan', coalesce(plan, 'free'), 'status', plan_status)
    into result
    from public.profiles
   where id = _user;
  return result;
end $$;

revoke all on function public.slides_init_key(text) from public;
revoke all on function public.slides_plan(text, uuid) from public;
grant execute on function public.slides_init_key(text) to anon, authenticated;
grant execute on function public.slides_plan(text, uuid) to anon, authenticated;
