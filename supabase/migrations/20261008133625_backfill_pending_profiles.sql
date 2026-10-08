-- Every account must have a profile row, and every profile must carry an
-- explicit application_status. Without one, the chat route treated a missing
-- row as approved and skipped the application gate. Backfill is intentionally
-- 'pending': a brand-new row must be reviewed before it can chat.
do $$
declare
  _u record;
  _base text;
  _candidate text;
  _n int;
begin
  for _u in
    select u.id, u.email, u.raw_user_meta_data
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
  loop
    _base := lower(regexp_replace(
      coalesce(nullif(_u.raw_user_meta_data ->> 'display_name', ''), split_part(_u.email, '@', 1), 'user'),
      '[^a-zA-Z0-9_]', '', 'g'));
    if length(_base) < 3 then
      _base := 'user' || substr(replace(_u.id::text, '-', ''), 1, 6);
    end if;
    _base := substr(_base, 1, 16);
    _candidate := _base;
    _n := 1;
    while exists (select 1 from public.profiles where lower(username) = _candidate) loop
      _candidate := substr(_base, 1, 16) || _n::text;
      _n := _n + 1;
    end loop;

    insert into public.profiles (id, display_name, username, application_status)
    values (
      _u.id,
      coalesce(nullif(_u.raw_user_meta_data ->> 'display_name', ''), split_part(_u.email, '@', 1), 'Unnamed'),
      _candidate,
      'pending'
    )
    on conflict (id) do nothing;
  end loop;
end $$;

-- Defence in depth: a NULL/unknown status can never be read as approved.
update public.profiles
set application_status = 'pending'
where application_status is null
   or application_status not in ('pending', 'approved', 'rejected');
