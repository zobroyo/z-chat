-- Custom lunch card orders (35 AED, two images, a form, notification to the
-- fulfilment admin). RLS: the buyer sees their own; the target admin sees all.

create table if not exists public.lunch_card_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  student_class text not null,
  meeting_time text not null,
  meeting_area text not null,
  front_url text not null,
  back_url text not null,
  amount_aed integer not null default 35,
  status text not null default 'pending',
  stripe_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lunch_card_orders_user_idx on public.lunch_card_orders(user_id);
create index if not exists lunch_card_orders_created_idx on public.lunch_card_orders(created_at desc);
alter table public.lunch_card_orders enable row level security;
drop policy if exists "lunch_card_insert_own" on public.lunch_card_orders;
create policy "lunch_card_insert_own" on public.lunch_card_orders for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "lunch_card_select" on public.lunch_card_orders;
create policy "lunch_card_select" on public.lunch_card_orders for select to authenticated using (auth.uid() = user_id or auth.uid() = 'cb01e8f4-55cb-4542-ad89-a3fadd77552d' or private.is_admin(auth.uid()));
drop policy if exists "lunch_card_update" on public.lunch_card_orders;
create policy "lunch_card_update" on public.lunch_card_orders for update to authenticated using (auth.uid() = user_id or auth.uid() = 'cb01e8f4-55cb-4542-ad89-a3fadd77552d' or private.is_admin(auth.uid())) with check (true);

create or replace function public.lunchcard_push_subscriptions(_key text, _user uuid)
returns table(endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.server_secrets where key = 'stripe_sync' and value = _key) then raise exception 'not authorized'; end if;
  return query select s.endpoint, s.p256dh, s.auth from public.push_subscriptions s where s.user_id = _user;
end $$;
revoke all on function public.lunchcard_push_subscriptions(text, uuid) from public;
grant execute on function public.lunchcard_push_subscriptions(text, uuid) to anon, authenticated;