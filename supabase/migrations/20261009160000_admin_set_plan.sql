-- Admins can gift a plan (free/pro/max) to any user. The plan columns are
-- otherwise protected by guard_profile_columns(); this RPC is the sanctioned
-- write path and marks gifted plans with plan_status = 'comped' so they are
-- distinguishable from real Stripe subscriptions.

create or replace function public.admin_set_plan(_target uuid, _plan text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;
  if _plan not in ('free', 'pro', 'max') then
    raise exception 'bad plan';
  end if;
  update public.profiles
     set plan = _plan,
         plan_status = case when _plan = 'free' then null else 'comped' end,
         plan_renews_at = null
   where id = _target;
end $$;

revoke all on function public.admin_set_plan(uuid, text) from public;
grant execute on function public.admin_set_plan(uuid, text) to authenticated;
