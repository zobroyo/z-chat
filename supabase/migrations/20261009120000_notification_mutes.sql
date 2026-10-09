-- Notification mutes: per-user opt-outs for message notifications.
-- A row means "do not notify me about this conversation / this sender".
-- Unread badges are unaffected; only notifications are suppressed.
create table if not exists public.notification_mutes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('conversation', 'user')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);

create index if not exists notification_mutes_user_idx
  on public.notification_mutes (user_id);

alter table public.notification_mutes enable row level security;

-- Owners manage their own mute list; nobody can read or change someone else's.
revoke all on table public.notification_mutes from public, anon, authenticated;
grant select, insert, delete on table public.notification_mutes to authenticated;
grant all on table public.notification_mutes to service_role;

drop policy if exists notification_mutes_select_own on public.notification_mutes;
create policy notification_mutes_select_own
  on public.notification_mutes
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists notification_mutes_insert_own on public.notification_mutes;
create policy notification_mutes_insert_own
  on public.notification_mutes
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists notification_mutes_delete_own on public.notification_mutes;
create policy notification_mutes_delete_own
  on public.notification_mutes
  for delete
  to authenticated
  using (user_id = (select auth.uid()));
