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

// Crop viewport (square, shown as a circle) and the exported image size.
const VIEW = 256;
const OUT = 512;
const MAX_ZOOM = 3;

type Props = {
  file: File | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (blob: Blob) => void | Promise<void>;
  applying?: boolean;
};

/**
 * Circular avatar cropper. The user drags to reposition and zooms with the
 * slider; "Apply" renders exactly what's inside the circle to a square canvas.
 */
export function AvatarCropDialog({ file, open, onOpenChange, onApply, applying = false }: Props) {
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

  const baseScale = nat ? Math.max(VIEW / nat.w, VIEW / nat.h) : 1;

  const clamp = useCallback(
    (o: { x: number; y: number }, z: number) => {
      if (!nat) return o;
      const s = baseScale * z;
      const maxX = Math.max(0, (nat.w * s) / 2 - VIEW / 2);
      const maxY = Math.max(0, (nat.h * s) / 2 - VIEW / 2);
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
    const size = VIEW / s;
    const sx = nat.w / 2 - (VIEW / 2 + offset.x) / s;
    const sy = nat.h / 2 - (VIEW / 2 + offset.y) / s;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, size, size, 0, 0, OUT, OUT);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) await onApply(blob);
  };

  const scale = baseScale * zoom;
  const displayW = nat ? nat.w * scale : 0;
  const displayH = nat ? nat.h * scale : 0;
  const left = (VIEW - displayW) / 2 + offset.x;
  const top = (VIEW - displayH) / 2 + offset.y;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Crop your photo</DialogTitle>
          <DialogDescription>Drag to move, use the slider to zoom, then apply.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            className="relative touch-none overflow-hidden rounded-full border border-border bg-surface-2 select-none"
            style={{ width: VIEW, height: VIEW, cursor: nat ? "grab" : "default" }}
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
