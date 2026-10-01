CREATE TABLE public.message_receipts (
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, recipient_id),
  CONSTRAINT message_receipts_read_requires_delivery
    CHECK (read_at IS NULL OR delivered_at IS NOT NULL)
);

CREATE INDEX message_receipts_conversation_idx
  ON public.message_receipts (conversation_id, message_id);

CREATE INDEX message_receipts_recipient_pending_idx
  ON public.message_receipts (recipient_id, conversation_id, message_id)
  WHERE delivered_at IS NULL;

ALTER TABLE public.message_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.message_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.message_receipts TO authenticated;
GRANT UPDATE (delivered_at, read_at)
  ON TABLE public.message_receipts TO authenticated;
GRANT ALL ON TABLE public.message_receipts TO service_role;

CREATE POLICY message_receipts_select
  ON public.message_receipts
  FOR SELECT
  TO authenticated
  USING (
    recipient_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.messages AS m
      WHERE m.id = public.message_receipts.message_id
        AND m.sender_id = (SELECT auth.uid())
    )
  );

CREATE POLICY message_receipts_update_own
  ON public.message_receipts
  FOR UPDATE
  TO authenticated
  USING (recipient_id = (SELECT auth.uid()))
  WITH CHECK (recipient_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION private.create_message_receipts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF caller_id IS NOT NULL AND NEW.sender_id IS DISTINCT FROM caller_id THEN
    RAISE EXCEPTION 'Message sender does not match the authenticated user';
  END IF;

  INSERT INTO public.message_receipts (
    message_id,
    conversation_id,
    recipient_id
  )
  SELECT
    NEW.id,
    NEW.conversation_id,
    cm.user_id
  FROM public.conversation_members AS cm
  JOIN auth.users AS recipient
    ON recipient.id = cm.user_id
  WHERE cm.conversation_id = NEW.conversation_id
    AND cm.user_id <> NEW.sender_id
  ON CONFLICT (message_id, recipient_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.create_message_receipts()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER messages_create_receipts
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION private.create_message_receipts();

INSERT INTO public.message_receipts (
  message_id,
  conversation_id,
  recipient_id,
  delivered_at,
  read_at
)
SELECT
  m.id,
  m.conversation_id,
  cm.user_id,
  CASE WHEN cm.last_read_at >= m.created_at THEN cm.last_read_at END,
  CASE WHEN cm.last_read_at >= m.created_at THEN cm.last_read_at END
FROM public.messages AS m
JOIN public.conversation_members AS cm
  ON cm.conversation_id = m.conversation_id
JOIN auth.users AS recipient
  ON recipient.id = cm.user_id
WHERE cm.user_id <> m.sender_id
  AND cm.joined_at <= m.created_at
ON CONFLICT (message_id, recipient_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'message_receipts'
  ) THEN
    EXECUTE
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.message_receipts';
  END IF;
END;
$$;
