CREATE OR REPLACE FUNCTION private.safe_uuid(_txt TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN _txt::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE POLICY "avatars_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');
CREATE POLICY "avatars_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "chat_media_select_members" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND private.can_access_conversation(private.safe_uuid((storage.foldername(name))[1]), auth.uid())
  );
CREATE POLICY "chat_media_insert_members" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND owner = auth.uid()
    AND private.can_access_conversation(private.safe_uuid((storage.foldername(name))[1]), auth.uid())
  );
CREATE POLICY "chat_media_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chat-media' AND owner = auth.uid());