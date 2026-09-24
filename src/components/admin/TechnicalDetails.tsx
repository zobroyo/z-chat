import { useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate font-mono text-xs">{value}</div>
      </div>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-surface-2"
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

export function TechnicalDetails({ items }: { items: { label: string; value: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground"
      >
        Technical details
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border px-3">
          {items.map((item) => (
            <CopyRow key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      )}
    </div>
  );
}
