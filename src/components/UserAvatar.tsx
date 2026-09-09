import { AVATAR_BUCKET, useSignedUrl } from "@/lib/media";
import { initialsOf } from "@/lib/chat";
import { cn } from "@/lib/utils";

type Props = {
  name: string | null | undefined;
  path?: string | null;
  online?: boolean;
  className?: string;
  fallback?: string;
};

export function UserAvatar({ name, path, online, className, fallback }: Props) {
  const url = useSignedUrl(AVATAR_BUCKET, path);

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span className="flex size-full items-center justify-center overflow-hidden rounded-full bg-surface-2 text-xs font-semibold text-muted-foreground ring-1 ring-border">
        {url ? (
          <img src={url} alt={name ?? "Profile picture"} className="size-full object-cover" />
        ) : (
          (fallback ?? initialsOf(name))
        )}
      </span>
      {online !== undefined && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface",
            online ? "bg-online" : "bg-surface-2",
          )}
        />
      )}
    </span>
  );
}
