import { Phone, PhoneCall } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Props = {
  onJoin: () => void;
  joining?: boolean;
  inCall?: boolean;
  disabled?: boolean;
};

/** Header button that starts (or re-focuses) the call for the open conversation. */
export function CallButton({ onJoin, joining = false, inCall = false, disabled = false }: Props) {
  const label = inCall ? "Call in progress" : joining ? "Joining call…" : "Start voice call";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={onJoin}
            disabled={disabled || inCall || joining}
            aria-label={label}
          >
            {inCall ? <PhoneCall className="size-5" /> : <Phone className="size-5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
