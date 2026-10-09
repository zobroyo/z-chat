-- Protected account: an account that cannot be banned, demoted, deleted, or
-- have its protection removed — enforced at the database level, so even an
-- admin (or an admin RPC) is refused.

alter table public.profiles
  add column if not exists protected boolean not null default false;

create or replace function private.guard_protected_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.protected then
      raise exception 'This account is protected and cannot be deleted.';
    end if;
    return old;
  end if;

  if old.protected then
    if new.protected is distinct from old.protected then
      raise exception 'This account is protected and cannot be unprotected.';
    end if;
    if new.banned is distinct from false then
      raise exception 'This account is protected and cannot be banned.';
    end if;
    if old.is_admin and new.is_admin = false then
      raise exception 'This account is protected and cannot be demoted.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_protected_profile on public.profiles;
create trigger guard_protected_profile
  before update or delete on public.profiles
  for each row execute function private.guard_protected_profile();

-- The owner account.
update public.profiles
   set protected = true,
       banned = false,
       is_admin = true
 where id = 'da7f066b-073f-4e3e-aea6-bca04d1dfefb';
