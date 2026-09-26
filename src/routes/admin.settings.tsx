import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  fetchChatSettings,
  updateChatSettings,
  fetchBlockedKeywords,
  addBlockedKeyword,
  setBlockedKeywordEnabled,
  deleteBlockedKeyword,
  type ChatSettings,
  type BlockedKeyword,
} from "@/lib/admin";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettings,
});

const LIMIT_PRESETS = [500, 1000, 2000, 4000];

function AdminSettings() {
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [keywords, setKeywords] = useState<BlockedKeyword[] | null>(null);
  const [customLimit, setCustomLimit] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    Promise.all([fetchChatSettings(), fetchBlockedKeywords()])
      .then(([s, k]) => {
        setSettings(s);
        setKeywords(k);
      })
      .catch((e) => setError(e.message ?? "Failed to load settings"));
  };

  useEffect(load, []);

  const applyLimit = async (limit: number) => {
    if (!settings || limit === settings.character_limit) return;
    setBusy(true);
    try {
      await updateChatSettings({ character_limit: limit });
      setSettings({ ...settings, character_limit: limit });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update limit");
    } finally {
      setBusy(false);
    }
  };

  const toggleModeration = async () => {
    if (!settings) return;
    const next = !settings.keyword_moderation_enabled;
    setBusy(true);
    try {
      await updateChatSettings({ keyword_moderation_enabled: next });
      setSettings({ ...settings, keyword_moderation_enabled: next });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update setting");
    } finally {
      setBusy(false);
    }
  };

  const addKeyword = async () => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await addBlockedKeyword(trimmed);
      setNewKeyword("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add keyword");
    } finally {
      setBusy(false);
    }
  };

  const toggleKeyword = async (kw: BlockedKeyword) => {
    setBusy(true);
    try {
      await setBlockedKeywordEnabled(kw.id, !kw.enabled);
      setKeywords((prev) => prev!.map((k) => (k.id === kw.id ? { ...k, enabled: !k.enabled } : k)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update keyword");
    } finally {
      setBusy(false);
    }
  };

  const removeKeyword = async (id: string) => {
    if (!window.confirm("Remove this blocked keyword?")) return;
    setBusy(true);
    try {
      await deleteBlockedKeyword(id);
      setKeywords((prev) => prev!.filter((k) => k.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove keyword");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;

  if (!settings || !keywords) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-8">
      <h1 className="font-display text-xl font-bold text-foreground">Message Controls</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Character limit</h2>
        <p className="text-xs text-muted-foreground">
          Enforced server-side — this applies no matter how a message is sent.
        </p>
        <div className="flex flex-wrap gap-2">
          {LIMIT_PRESETS.map((limit) => (
            <button
              key={limit}
              disabled={busy}
              onClick={() => void applyLimit(limit)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                settings.character_limit === limit
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-2 text-muted-foreground hover:text-foreground"
              }`}
            >
              {limit.toLocaleString()}
            </button>
          ))}
          <div className="flex items-center gap-1.5">
            <Input
              value={customLimit}
              onChange={(e) => setCustomLimit(e.target.value.replace(/\D/g, ""))}
              placeholder="Custom"
              className="h-8 w-24"
            />
            <Button
              size="sm"
              className="h-8"
              disabled={busy || !customLimit}
              onClick={() => {
                const n = Number(customLimit);
                if (n > 0) {
                  void applyLimit(n);
                  setCustomLimit("");
                }
              }}
            >
              Set
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Current limit: {settings.character_limit.toLocaleString()} characters.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Keyword moderation</h2>
            <p className="text-xs text-muted-foreground">
              Blocks messages containing any enabled keyword below. Enforced server-side.
            </p>
          </div>
          <Switch
            checked={settings.keyword_moderation_enabled}
            disabled={busy}
            onCheckedChange={() => void toggleModeration()}
          />
        </div>

        <div className="flex gap-1.5">
          <Input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="Add a blocked word"
            onKeyDown={(e) => e.key === "Enter" && void addKeyword()}
          />
          <Button
            size="icon"
            disabled={busy || !newKeyword.trim()}
            onClick={() => void addKeyword()}
            aria-label="Add keyword"
          >
            <Plus className="size-4" />
          </Button>
        </div>

        {keywords.length === 0 ? (
          <p className="text-sm text-muted-foreground">No blocked keywords yet.</p>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-surface">
            {keywords.map((kw) => (
              <div key={kw.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span
                  className={`text-sm ${kw.enabled ? "text-foreground" : "text-muted-foreground line-through"}`}
                >
                  {kw.keyword}
                </span>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={kw.enabled}
                    disabled={busy}
                    onCheckedChange={() => void toggleKeyword(kw)}
                  />
                  <button
                    onClick={() => void removeKeyword(kw.id)}
                    disabled={busy}
                    aria-label={`Remove ${kw.keyword}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
