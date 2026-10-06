-- Per-conversation AI moderation scope.
-- DMs are never AI-moderated (handled in the app); groups carry their own
-- toggle controlled by the group owner; the public room uses the global
-- chat_settings.ai_moderation_enabled value.
alter table public.conversations
  add column if not exists ai_moderation_enabled boolean not null default true;

drop policy if exists conversations_update_owner on public.conversations;
create policy conversations_update_owner on public.conversations for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());
