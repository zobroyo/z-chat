-- Close the conversation_members self-join hole.
--
-- Previously `members_insert` allowed `user_id = auth.uid()`, so ANY signed-in
-- user could insert their own membership into ANY conversation — joining a
-- private group and then reading/posting in it. Membership should only be added
-- by the conversation creator (or an existing member / admin).
--
-- The app only inserts members at DM/group creation (by the creator), so this
-- change is behaviour-preserving for legitimate flows.

drop policy if exists "members_insert" on public.conversation_members;
create policy "members_insert" on public.conversation_members
  for insert to authenticated
  with check (
    private.is_admin(auth.uid())
    or private.is_conversation_member(conversation_id, auth.uid())
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_members.conversation_id
        and c.created_by = auth.uid()
    )
  );
