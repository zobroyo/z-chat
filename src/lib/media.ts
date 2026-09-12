import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

export const AVATAR_BUCKET = "avatars";
export const CHAT_BUCKET = "chat-media";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** Browsers can't show HEIC/HEIF in an <img>, so we refuse it up front. */
const HEIC_PATTERN = /(heic|heif)/i;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const HEIC_MESSAGE =
  "iPhone HEIC photos can't be shown here. Please choose a JPEG or PNG instead.";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const signedCache = new Map<string, { url: string; expires: number }>();

/** Files live in private storage, so every render needs a short-lived signed URL. */
export async function getSignedUrl(bucket: string, path: string | null | undefined) {
  if (!path) return null;
  const key = `${bucket}/${path}`;
  const cached = signedCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.url;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;

  signedCache.set(key, { url: data.signedUrl, expires: Date.now() + 45 * 60 * 1000 });
  return data.signedUrl;
}

export function useSignedUrl(bucket: string, path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl(null);
      return;
    }
    getSignedUrl(bucket, path).then((next) => {
      if (active) setUrl(next);
    });
    return () => {
      active = false;
    };
  }, [bucket, path]);

  return url;
}

function extensionFor(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (/^[a-z0-9]{1,5}$/.test(fromName)) return fromName;
  return file.type === "image/png" ? "png" : "jpg";
}

export function validateImage(file: File, maxBytes: number) {
  if (HEIC_PATTERN.test(file.type) || HEIC_PATTERN.test(file.name)) {
    throw new Error(HEIC_MESSAGE);
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Please pick an image file (PNG, JPG, WebP or GIF).");
  }
  if (file.size > maxBytes) {
    throw new Error(`That image is too big. Max ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
}

const validate = validateImage;


export async function uploadAvatar(userId: string, file: File) {
  validate(file, MAX_AVATAR_BYTES);
  const path = `${userId}/avatar-${Date.now()}.${extensionFor(file)}`;
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  return path;
}

export async function uploadChatImage(conversationId: string, file: File) {
  validate(file, MAX_IMAGE_BYTES);
  const path = `${conversationId}/${crypto.randomUUID()}.${extensionFor(file)}`;
  const { error } = await supabase.storage
    .from(CHAT_BUCKET)
    .upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}
