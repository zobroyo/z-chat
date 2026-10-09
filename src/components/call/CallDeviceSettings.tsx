import { useCallback, useEffect, useState } from "react";
import { Mic, Speaker, Video } from "lucide-react";

import { PopoverContent } from "@/components/ui/popover";
import { CALL_DEVICES_CHANGED_EVENT } from "@/hooks/use-call";

const KEYS = { mic: "zcall:mic", cam: "zcall:cam", spk: "zcall:spk" } as const;
type DeviceKind = keyof typeof KEYS;

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
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

  const renderSelect = (
    kind: DeviceKind,
    label: string,
    icon: React.ReactNode,
    items: MediaDeviceInfo[],
  ) => (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-white/80">
        {icon}
        {label}
      </span>
      <select
        value={picked[kind]}
        onChange={(event) => update(kind, event.target.value)}
        className="w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-xs text-white outline-none"
      >
        <option value="">System default</option>
        {items.map((device, index) => (
          <option key={device.deviceId || index} value={device.deviceId}>
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <PopoverContent
      align="end"
      side="top"
      className="w-80 space-y-3 border-white/10 bg-[#0d1016]/95 text-white backdrop-blur-xl"
    >
      {renderSelect("mic", "Microphone", <Mic className="size-3.5" />, devices.mic)}
      {renderSelect("cam", "Camera", <Video className="size-3.5" />, devices.cam)}
      {renderSelect("spk", "Speaker / output", <Speaker className="size-3.5" />, devices.spk)}
      <p className="text-[10px] leading-4 text-white/50">
        Output changes apply immediately. Microphone and camera changes apply the next time you
        enable them.
      </p>
    </PopoverContent>
  );
}
