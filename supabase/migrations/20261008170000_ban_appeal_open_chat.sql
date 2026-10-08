-- "Open Chat": the ban conversation between a banned user and moderators.
-- Replaces the one-shot banned_appeals flow with a real thread (multiple
-- messages, live updates). Works while banned — this is the one open channel.

create table if not exists public.ban_appeal_threads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ban_appeal_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  is_moderator boolean not null default false,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists ban_appeal_messages_user_idx
  on public.ban_appeal_messages (user_id, created_at);

alter table public.ban_appeal_threads enable row level security;
alter table public.ban_appeal_messages enable row level security;

-- threads: the owner or an admin can read; owner/admin create; admin updates.
drop policy if exists ban_appeal_threads_select on public.ban_appeal_threads;
create policy ban_appeal_threads_select on public.ban_appeal_threads
  for select to authenticated
  using (user_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists ban_appeal_threads_insert on public.ban_appeal_threads;
create policy ban_appeal_threads_insert on public.ban_appeal_threads
  for insert to authenticated
  with check (user_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists ban_appeal_threads_update on public.ban_appeal_threads;
create policy ban_appeal_threads_update on public.ban_appeal_threads
  for update to authenticated
  using (private.is_admin(auth.uid()))
  with check (private.is_admin(auth.uid()));

-- messages: owner or admin read; sender must be the author; only admins set
-- is_moderator; a user may only post in their own thread.
drop policy if exists ban_appeal_messages_select on public.ban_appeal_messages;
create policy ban_appeal_messages_select on public.ban_appeal_messages
  for select to authenticated
  using (user_id = auth.uid() or private.is_admin(auth.uid()));

drop policy if exists ban_appeal_messages_insert on public.ban_appeal_messages;
create policy ban_appeal_messages_insert on public.ban_appeal_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (user_id = auth.uid() or private.is_admin(auth.uid()))
    and is_moderator = private.is_admin(auth.uid())
  );

-- keep the thread's updated_at fresh on every message
create or replace function public.touch_ban_appeal_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ban_appeal_threads
     set updated_at = now()
   where user_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists ban_appeal_messages_touch on public.ban_appeal_messages;
create trigger ban_appeal_messages_touch
  after insert on public.ban_appeal_messages
  for each row execute function public.touch_ban_appeal_thread();

-- live updates for both sides
do $$
begin
  alter publication supabase_realtime add table public.ban_appeal_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.ban_appeal_threads;
exception when duplicate_object then null;
end $$;
