-- The public "General" room must always exist and can never be deleted.
-- Re-create it if it is ever missing, and hard-block any DELETE (or kind
-- change) that would remove it. The 50+ member friends-only gate that used
-- to hide things has been removed from the client separately.

insert into public.conversations (id, kind, name)
values ('00000000-0000-0000-0000-000000000001', 'public', 'General')
on conflict (id) do nothing;

create or replace function private.protect_public_conversations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'public' then
      raise exception 'The public room cannot be deleted';
    end if;
    return old;
  end if;

  if old.kind = 'public' and new.kind <> 'public' then
    raise exception 'The public room cannot be changed to another kind';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_public_conversations on public.conversations;
create trigger protect_public_conversations
  before delete or update of kind on public.conversations
  for each row execute function private.protect_public_conversations();
