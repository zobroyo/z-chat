CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_conversation_member(_conversation_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = _conversation_id AND user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION private.can_access_conversation(_conversation_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = _conversation_id
      AND (c.kind = 'public' OR private.is_conversation_member(c.id, _user_id))
  );
$$;

DROP POLICY "conversations_select" ON public.conversations;
CREATE POLICY "conversations_select" ON public.conversations FOR SELECT TO authenticated
  USING (kind = 'public' OR private.is_conversation_member(id, auth.uid()));

DROP POLICY "members_select" ON public.conversation_members;
CREATE POLICY "members_select" ON public.conversation_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_conversation_member(conversation_id, auth.uid()));

DROP POLICY "members_insert" ON public.conversation_members;
CREATE POLICY "members_insert" ON public.conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR private.is_conversation_member(conversation_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.created_by = auth.uid())
  );

DROP POLICY "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages FOR SELECT TO authenticated
  USING (private.can_access_conversation(conversation_id, auth.uid()));

DROP POLICY "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND private.can_access_conversation(conversation_id, auth.uid()));

DROP FUNCTION public.can_access_conversation(UUID, UUID);
DROP FUNCTION public.is_conversation_member(UUID, UUID);