create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select
  on public.push_subscriptions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy push_subscriptions_insert
  on public.push_subscriptions
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy push_subscriptions_delete
  on public.push_subscriptions
  for delete
  to authenticated
  using (user_id = auth.uid());