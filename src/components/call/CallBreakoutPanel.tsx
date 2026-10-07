import { DoorOpen, Plus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BreakoutRoom, CallParticipant } from "@/hooks/use-call";

const MAIN_ROOM = "__main__";

type Props = {
  rooms: BreakoutRoom[];
  participants: CallParticipant[];
  selfId: string;
  myRoomId: string | null;
  isHost: boolean;
  onCreateRoom: () => void;
  onMove: (participantId: string, roomId: string | null) => void;
  onCloseAll: () => void;
};

/**
 * Host panel for breakout rooms. Membership is authoritative on the host:
 * moving someone broadcasts the full room map, and every client keeps media
 * connections only with peers in its own room.
 */
export function CallBreakoutPanel({
  rooms,
  participants,
  selfId,
  myRoomId,
  isHost,
  onCreateRoom,
  onMove,
  onCloseAll,
}: Props) {
  const occupants = (roomId: string | null) =>
    participants.filter((participant) => (participant.roomId ?? null) === roomId);

  const mainCount = occupants(null).length + (myRoomId === null ? 1 : 0);

  return (
    <PopoverContent align="end" className="w-80">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Breakout rooms
        </p>
        {isHost && (
          <Button type="button" variant="secondary" size="sm" onClick={onCreateRoom}>
            <Plus className="mr-1 size-3.5" />
            New room
          </Button>
        )}
      </div>

      <p className="mt-1 text-[11px] text-muted-foreground">
        Only people in the same room can hear each other.
      </p>

      <div className="mt-3 space-y-3">
        <div className="rounded-xl border border-border p-2">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Users className="size-3.5 text-muted-foreground" />
            Main room
            <span className="ml-auto text-muted-foreground">{mainCount}</span>
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {occupants(null)
              .map((participant) => participant.name)
              .join(", ") || "Nobody here"}
            {myRoomId === null ? `${occupants(null).length ? ", " : ""}You` : ""}
          </p>
        </div>

        {rooms.map((room) => (
          <div key={room.id} className="rounded-xl border border-border p-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <DoorOpen className="size-3.5 text-muted-foreground" />
              {room.name}
              <span className="ml-auto text-muted-foreground">
                {occupants(room.id).length + (myRoomId === room.id ? 1 : 0)}
              </span>
            </div>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {occupants(room.id)
                .map((participant) => participant.name)
                .join(", ") || "Nobody here"}
              {myRoomId === room.id ? `${occupants(room.id).length ? ", " : ""}You` : ""}
            </p>
          </div>
        ))}
      </div>

      {isHost && participants.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Move participants
          </p>
          {participants.map((participant) => (
            <div key={participant.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs">
                {participant.id === selfId ? "You" : participant.name}
              </span>
              <Select
                value={participant.roomId ?? MAIN_ROOM}
                onValueChange={(value) => onMove(participant.id, value === MAIN_ROOM ? null : value)}
              >
                <SelectTrigger className="h-8 w-36 text-xs" aria-label={`Room for ${participant.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MAIN_ROOM}>Main room</SelectItem>
                  {rooms.map((room) => (
                    <SelectItem key={room.id} value={room.id}>
                      {room.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}

      {isHost && rooms.length > 0 && (
        <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={onCloseAll}>
          Close breakouts (everyone back to main)
        </Button>
      )}
    </PopoverContent>
  );
}
