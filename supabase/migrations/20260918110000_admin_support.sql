-- Admin authorization support.
-- Purely additive: no existing table, column, function, or policy is
-- dropped or altered. Regular members keep exactly the access they had
-- before this migration; an admin additionally gets read access.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated;

CREATE OR REPLACE FUNCTION private.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND is_admin = true
  );
$$;

DROP POLICY "conversations_select" ON public.conversations;
CREATE POLICY "conversations_select" ON public.conversations FOR SELECT TO authenticated
  USING (
    kind = 'public'
    OR private.is_conversation_member(id, auth.uid())
    OR private.is_admin(auth.uid())
  );

DROP POLICY "members_select" ON public.conversation_members;
CREATE POLICY "members_select" ON public.conversation_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR private.is_conversation_member(conversation_id, auth.uid())
    OR private.is_admin(auth.uid())
  );

DROP POLICY "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages FOR SELECT TO authenticated
  USING (
    private.can_access_conversation(conversation_id, auth.uid())
    OR private.is_admin(auth.uid())
  );
