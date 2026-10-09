import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Mic, Speaker, Video } from "lucide-react";

import { PopoverContent } from "@/components/ui/popover";
import { CALL_DEVICES_CHANGED_EVENT } from "@/hooks/use-call";
import { cn } from "@/lib/utils";

const KEYS = { mic: "zcall:mic", cam: "zcall:cam", spk: "zcall:spk" } as const;
type DeviceKind = keyof typeof KEYS;

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

type DeviceDropdownProps = {
  label: string;
  icon: React.ReactNode;
  items: MediaDeviceInfo[];
  value: string;
  onSelect: (deviceId: string) => void;
};

/** Dark, app-styled dropdown replacing the native <select>. */
function DeviceDropdown({ label, icon, items, value, onSelect }: DeviceDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = items.find((device) => device.deviceId === value);
  const currentLabel = current?.label || (value ? `${label} (saved)` : "System default");

  return (
    <div className="space-y-1.5" ref={rootRef}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-white/80">
        {icon}
        {label}
      </span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value_) => !value_)}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-2 text-left text-xs text-white transition-colors hover:bg-white/10"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label}
        >
          <span className="truncate">{currentLabel}</span>
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-white/60 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <div
            role="listbox"
            aria-label={label}
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-white/15 bg-[#141821] p-1 shadow-2xl"
          >
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => {
                onSelect("");
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-white/90 transition-colors hover:bg-white/10"
            >
              <span className="truncate">System default</span>
              {!value && <Check className="size-3.5 shrink-0 text-primary" />}
            </button>
            {items.map((device, index) => {
              const selected = device.deviceId === value;
              return (
                <button
                  key={device.deviceId || index}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onSelect(device.deviceId);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-white/90 transition-colors hover:bg-white/10",
                    selected && "bg-white/10",
                  )}
                >
                  <span className="truncate">{device.label || `${label} ${index + 1}`}</span>
                  {selected && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * In-call device picker: microphone input, camera input and speaker output.
 * Selections persist per browser; output changes apply immediately, while
 * mic/camera picks are picked up the next time each is enabled.
 */
export function CallDeviceSettings() {
  const [devices, setDevices] = useState<{
    mic: MediaDeviceInfo[];
    cam: MediaDeviceInfo[];
    spk: MediaDeviceInfo[];
  }>({ mic: [], cam: [], spk: [] });
  const [picked, setPicked] = useState<Record<DeviceKind, string>>({
    mic: readStored(KEYS.mic),
    cam: readStored(KEYS.cam),
    spk: readStored(KEYS.spk),
  });

  const refresh = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        mic: list.filter((device) => device.kind === "audioinput"),
        cam: list.filter((device) => device.kind === "videoinput"),
        spk: list.filter((device) => device.kind === "audiooutput"),
      });
    } catch {
      // Permissions or an exotic browser: leave the lists empty.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const media = navigator.mediaDevices;
    if (!media) return;
    const onChange = () => void refresh();
    media.addEventListener?.("devicechange", onChange);
    return () => media.removeEventListener?.("devicechange", onChange);
  }, [refresh]);

  const update = (kind: DeviceKind, value: string) => {
    setPicked((current) => ({ ...current, [kind]: value }));
    try {
      localStorage.setItem(KEYS[kind], value);
    } catch {
      // Private mode: selection still applies for this call.
    }
    window.dispatchEvent(new Event(CALL_DEVICES_CHANGED_EVENT));
  };

  return (
    <PopoverContent
      align="end"
      side="top"
      className="w-80 space-y-3 border-white/10 bg-[#0d1016]/95 text-white backdrop-blur-xl"
    >
      <DeviceDropdown
        label="Microphone"
        icon={<Mic className="size-3.5" />}
        items={devices.mic}
        value={picked.mic}
        onSelect={(deviceId) => update("mic", deviceId)}
      />
      <DeviceDropdown
        label="Camera"
        icon={<Video className="size-3.5" />}
        items={devices.cam}
        value={picked.cam}
        onSelect={(deviceId) => update("cam", deviceId)}
      />
      <DeviceDropdown
        label="Speaker / output"
        icon={<Speaker className="size-3.5" />}
        items={devices.spk}
        value={picked.spk}
        onSelect={(deviceId) => update("spk", deviceId)}
      />
      <p className="text-[10px] leading-4 text-white/50">
        Output changes apply immediately. Microphone and camera changes apply the next time you
        enable them.
      </p>
    </PopoverContent>
  );
}
