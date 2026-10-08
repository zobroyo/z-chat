-- Application form: questions are data rows (editable from the admin console),
-- answers are stored on the applicant's profile.
create table if not exists public.application_form (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(trim(label)) between 1 and 120),
  placeholder text not null default '' check (char_length(placeholder) <= 200),
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.application_form enable row level security;

-- Signed-in applicants only ever need the enabled questions; admins see all.
drop policy if exists application_form_select on public.application_form;
create policy application_form_select
  on public.application_form
  for select
  to authenticated
  using (enabled or (select private.is_admin(auth.uid())));

drop policy if exists application_form_insert on public.application_form;
create policy application_form_insert
  on public.application_form
  for insert
  to authenticated
  with check ((select private.is_admin(auth.uid())));

drop policy if exists application_form_update on public.application_form;
create policy application_form_update
  on public.application_form
  for update
  to authenticated
  using ((select private.is_admin(auth.uid())))
  with check ((select private.is_admin(auth.uid())));

drop policy if exists application_form_delete on public.application_form;
create policy application_form_delete
  on public.application_form
  for delete
  to authenticated
  using ((select private.is_admin(auth.uid())));

-- Seed the default questions once, when the table is still empty.
insert into public.application_form (label, placeholder, sort_order)
select seed.label, seed.placeholder, seed.sort_order
from (
  values
    ('Who Are You?', 'A short intro - your name, age, where you are from', 1),
    ('Full Real name', 'First and last name', 2),
    ('Why are you joining', 'What brings you to Z Chat?', 3),
    ('How did you hear about us?', 'Friend, Discord, a game, ...', 4)
) as seed(label, placeholder, sort_order)
where not exists (select 1 from public.application_form);

create index if not exists application_form_sort_idx
  on public.application_form (sort_order)
  where enabled;

-- Answers live on the profile so the review UI has everything in one row.
alter table public.profiles
  add column if not exists application_answers jsonb not null default '{}'::jsonb,
  add column if not exists application_submitted_at timestamptz;

-- Applicant-facing submit (create or edit while still pending). Validates that
-- every enabled question is answered with 1..200 characters and stores only the
-- answers that belong to a current question.
create or replace function public.submit_application(_answers jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _answers_clean jsonb := '{}'::jsonb;
  _question record;
  _value text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in';
  end if;
  if _answers is null or jsonb_typeof(_answers) <> 'object' then
    raise exception 'Answers must be an object';
  end if;

  for _question in
    select id, label
    from public.application_form
    where enabled
    order by sort_order, created_at
  loop
    _value := _answers ->> _question.id::text;
    if _value is null or length(trim(_value)) = 0 then
      raise exception 'Please answer every question (% is missing)', _question.label;
    end if;
    _value := trim(_value);
    if char_length(_value) > 200 then
      raise exception 'Answers must be 200 characters or fewer';
    end if;
    _answers_clean := _answers_clean || jsonb_build_object(_question.id::text, _value);
  end loop;

  update public.profiles
  set application_answers = _answers_clean,
      application_submitted_at = now(),
      updated_at = now()
  where id = (select auth.uid())
    and application_status = 'pending';

  if not found then
    raise exception 'This application is not open for submission';
  end if;
end;
$$;

revoke all on function public.submit_application(jsonb) from public, anon;
grant execute on function public.submit_application(jsonb) to authenticated;

-- Admin console: most recent applications that have answers.
create or replace function public.admin_application_submissions(_limit integer default 25)
returns table (
  user_id uuid,
  display_name text,
  username text,
  created_at timestamptz,
  application_status text,
  application_submitted_at timestamptz,
  application_answers jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id,
         p.display_name,
         p.username,
         p.created_at,
         p.application_status,
         p.application_submitted_at,
         p.application_answers
  from public.profiles p
  where (select private.is_admin(auth.uid()))
    and p.application_submitted_at is not null
  order by p.application_submitted_at desc
  limit greatest(1, least(coalesce(_limit, 25), 100));
$$;

revoke all on function public.admin_application_submissions(integer) from public, anon;
grant execute on function public.admin_application_submissions(integer) to authenticated;

-- Push: an admin may read (to send an approval notification) and prune the
-- target user's subscriptions. RLS on push_subscriptions stays user-only.
create or replace function public.admin_push_subscriptions(_user_id uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where (select private.is_admin(auth.uid()))
    and s.user_id = _user_id;
$$;

revoke all on function public.admin_push_subscriptions(uuid) from public, anon;
grant execute on function public.admin_push_subscriptions(uuid) to authenticated;

create or replace function public.admin_delete_push_subscription(_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.push_subscriptions
  where id = _id
    and (select private.is_admin(auth.uid()));
$$;

revoke all on function public.admin_delete_push_subscription(uuid) from public, anon;
grant execute on function public.admin_delete_push_subscription(uuid) to authenticated;

-- Approval pushes look subscriptions up by user id.
create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);
