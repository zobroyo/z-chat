-- Admin accounts are never timed out by the AI moderation.
-- Blocked admin messages are still logged, but no strikes are counted and no
-- timeout is applied. Non-admins keep the 3-strikes-in-10-minutes auto-timeout.
create or replace function public.record_moderation_block(
  p_conversation_id uuid,
  p_body text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_strikes integer;
  v_last timestamptz;
  v_timeout timestamptz;
  v_is_admin boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select moderation_strikes, last_strike_at, is_admin
    into v_strikes, v_last, v_is_admin
    from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'profile not found';
  end if;

  -- Admins are never timed out by the AI: the message is simply blocked/logged.
  if v_is_admin then
    insert into public.moderation_log(user_id, conversation_id, body, verdict, reason, action)
    values (v_uid, p_conversation_id, left(coalesce(p_body, ''), 1000), 'blocked', p_reason,
            'message blocked (admin - no timeout)');
    return jsonb_build_object('strikes', coalesce(v_strikes, 0), 'timeout_until', null);
  end if;

  if v_last is null or now() - v_last > interval '10 minutes' then
    v_strikes := 1;
  else
    v_strikes := coalesce(v_strikes, 0) + 1;
  end if;
  v_timeout := null;
  if v_strikes >= 3 then
    v_timeout := now() + interval '10 minutes';
    v_strikes := 0;
  end if;
  update public.profiles
    set moderation_strikes = v_strikes,
        last_strike_at = now(),
        timeout_until = coalesce(v_timeout, timeout_until),
        timeout_reason = case when v_timeout is not null then 'Auto-timeout: repeated blocked messages' else timeout_reason end
    where id = v_uid;
  insert into public.moderation_log(user_id, conversation_id, body, verdict, reason, action)
  values (v_uid, p_conversation_id, left(coalesce(p_body, ''), 1000), 'blocked', p_reason,
          case when v_timeout is not null then 'auto-timeout 10m' else format('%s strike(s)', v_strikes) end);
  return jsonb_build_object('strikes', v_strikes, 'timeout_until', v_timeout);
end;
$$;
revoke all on function public.record_moderation_block(uuid, text, text) from public;
grant execute on function public.record_moderation_block(uuid, text, text) to authenticated;
