import { useState } from "react";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { groupNameSchema, type Profile } from "@/lib/chat";

type Props = {
  people: Profile[];
  onCreate: (name: string, memberIds: string[]) => Promise<void>;
};

export function NewGroupDialog({ people, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const needle = filter.trim().toLowerCase();
  const visiblePeople = needle
    ? people.filter((person) => person.display_name.toLowerCase().includes(needle))
    : people;

  const submit = async () => {
    const parsed = groupNameSchema.safeParse(name);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Pick a group name");
      return;
    }
    if (selected.length === 0) {
      toast.error("Pick at least one person");
      return;
    }
    setBusy(true);
    try {
      await onCreate(parsed.data, selected);
      setOpen(false);
      setName("");
      setFilter("");
      setSelected([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the group");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="New group">
          <Users className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">New group</DialogTitle>
          <DialogDescription>Name it and pick who&apos;s in.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Group name</Label>
            <Input
              id="group-name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder="Weekend crew"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="group-people">Members</Label>
            <Input
              id="group-people"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search people"
              className="h-9"
            />
            <div className="scroll-slim max-h-56 space-y-1 overflow-y-auto rounded-xl bg-surface-2 p-2">
              {visiblePeople.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">
                  {people.length === 0 ? "No one else has signed up yet." : "No one matches that search."}
                </p>
              )}
              {visiblePeople.map((person) => (
                <label
                  key={person.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface"
                >
                  <Checkbox
                    checked={selected.includes(person.id)}
                    onCheckedChange={() => toggle(person.id)}
                  />
                  <UserAvatar
                    name={person.display_name}
                    path={person.avatar_url}
                    className="size-7"
                  />
                  <span className="truncate text-sm">{person.display_name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
