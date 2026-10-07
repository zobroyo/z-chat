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
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const signedCache = new Map<string, { url: string; expires: number }>();

/** New media lives on the black box ("bb:" paths); old media stays on Supabase. */
function boxUrlFor(path: string): string | null {
  return path.startsWith("bb:") ? `/media/${path.slice(3)}` : null;
}

/** Files live in private storage, so every render needs a short-lived signed URL. */
export async function getSignedUrl(bucket: string, path: string | null | undefined) {
  if (!path) return null;
  const boxUrl = boxUrlFor(path);
  if (boxUrl) return boxUrl;
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

/** Upload to the black box (replaces Supabase Storage, which is on the free plan). */
async function uploadToBox(bucket: string, relPath: string, file: File): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again to upload");
  const response = await fetch(`/media/api/upload?bucket=${encodeURIComponent(bucket)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Path": relPath,
    },
    body: file,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(detail?.message || "Upload failed. Please try again.");
  }
  const result = (await response.json()) as { path?: string };
  if (!result.path) throw new Error("Upload failed. Please try again.");
  return result.path;
}

export async function uploadAvatar(userId: string, file: File) {
  validate(file, MAX_AVATAR_BYTES);
  const path = `${userId}/avatar-${Date.now()}.${extensionFor(file)}`;
  return uploadToBox(AVATAR_BUCKET, path, file);
}

export async function uploadChatImage(conversationId: string, file: File) {
  validate(file, MAX_IMAGE_BYTES);
  const path = `${conversationId}/${crypto.randomUUID()}.${extensionFor(file)}`;
  return uploadToBox(CHAT_BUCKET, path, file);
}
