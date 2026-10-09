import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Card aspect ratio 85.6 : 54 (landscape, like a bank card).
const VIEW_W = 340;
const VIEW_H = Math.round((VIEW_W * 54) / 85.6); // 214
const OUT_W = 856;
const OUT_H = 540;
const MAX_ZOOM = 3;

type Props = {
  file: File | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (blob: Blob) => void | Promise<void>;
  applying?: boolean;
  sideLabel?: string;
};

/**
 * Landscape cropper for the lunch card: the user drags/zooms and "Apply" renders
 * exactly what's inside the card-shaped frame (85.6:54) to an 856x540 image.
 */
export function CardCropDialog({ file, open, onOpenChange, onApply, applying = false, sideLabel }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (!file) {
      setSrc(null);
      setNat(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSrc(url);
    setNat(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const baseScale = nat ? Math.max(VIEW_W / nat.w, VIEW_H / nat.h) : 1;

  const clamp = useCallback(
    (o: { x: number; y: number }, z: number) => {
      if (!nat) return o;
      const s = baseScale * z;
      const maxX = Math.max(0, (nat.w * s) / 2 - VIEW_W / 2);
      const maxY = Math.max(0, (nat.h * s) / 2 - VIEW_H / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, o.x)),
        y: Math.min(maxY, Math.max(-maxY, o.y)),
      };
    },
    [nat, baseScale],
  );

  useEffect(() => {
    setOffset((o) => clamp(o, zoom));
  }, [zoom, clamp]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!nat) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clamp({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }, zoom));
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const apply = async () => {
    const img = imgRef.current;
    if (!img || !nat) return;
    const s = baseScale * zoom;
    const sizeW = VIEW_W / s;
    const sizeH = VIEW_H / s;
    const sx = nat.w / 2 - (VIEW_W / 2 + offset.x) / s;
    const sy = nat.h / 2 - (VIEW_H / 2 + offset.y) / s;
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sizeW, sizeH, 0, 0, OUT_W, OUT_H);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) await onApply(blob);
  };

  const scale = baseScale * zoom;
  const displayW = nat ? nat.w * scale : 0;
  const displayH = nat ? nat.h * scale : 0;
  const left = (VIEW_W - displayW) / 2 + offset.x;
  const top = (VIEW_H - displayH) / 2 + offset.y;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            Crop {sideLabel ? `${sideLabel} ` : ""}photo
          </DialogTitle>
          <DialogDescription>
            Drag to move, slide to zoom. The frame is card-shaped (85.6 x 54).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            className="relative touch-none overflow-hidden rounded-xl border border-border bg-surface-2 select-none"
            style={{ width: VIEW_W, height: VIEW_H, cursor: nat ? "grab" : "default" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {src && (
              <img
                ref={imgRef}
                src={src}
                alt=""
                draggable={false}
                onLoad={(e) =>
                  setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
                style={{
                  position: "absolute",
                  left: `${left}px`,
                  top: `${top}px`,
                  width: `${displayW}px`,
                  height: `${displayH}px`,
                  maxWidth: "none",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>

          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="w-full accent-[var(--primary)]"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void apply()} disabled={applying || !nat}>
            {applying && <Loader2 className="mr-2 size-4 animate-spin" />}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
