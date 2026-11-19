import { type PointerEvent, useState } from "react";

/**
 * Shows a preview the way the photographer chose. Watermark and black & white
 * come already burned into the image from the server; here we only add the
 * "reveal" effect: the photo stays blurred and a circle around the pointer or
 * finger shows it sharp. Right click and dragging are blocked as a deterrent.
 */
export function ProtectedImage({
  src,
  alt,
  reveal,
  radius = 70,
  touchReveal = false,
  className = "",
  imgClassName = "",
  loading,
}: {
  src: string;
  alt: string;
  reveal: boolean;
  radius?: number;
  /** Reveal while dragging a finger (full view). In grids touch keeps scrolling. */
  touchReveal?: boolean;
  className?: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const block = (event: { preventDefault: () => void }) => event.preventDefault();

  if (!reveal) {
    return (
      <img
        src={src}
        alt={alt}
        loading={loading}
        draggable={false}
        onContextMenu={block}
        className={`${className} ${imgClassName} select-none`}
      />
    );
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" && !touchReveal) return;
    const box = event.currentTarget.getBoundingClientRect();
    setPoint({ x: event.clientX - box.left, y: event.clientY - box.top });
  }

  const mask = point
    ? `radial-gradient(circle ${radius}px at ${point.x}px ${point.y}px, #000 55%, transparent 100%)`
    : "radial-gradient(circle 0px at 0 0, #000, transparent)";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer tracking for a visual effect; the image keeps its alt text
    <div
      className={`relative overflow-hidden select-none ${className}`}
      onPointerMove={move}
      onPointerDown={move}
      onPointerLeave={() => setPoint(null)}
      onPointerUp={(event) => event.pointerType === "touch" && setPoint(null)}
      onContextMenu={block}
      style={touchReveal ? { touchAction: "none" } : undefined}
    >
      <img
        src={src}
        alt={alt}
        loading={loading}
        draggable={false}
        aria-hidden="true"
        className={`${imgClassName} scale-110 blur-xl`}
      />
      <img
        src={src}
        alt={alt}
        loading={loading}
        draggable={false}
        className={`${imgClassName} absolute inset-0 size-full`}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      />
      {point ? null : (
        <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-void/70 px-3 py-1 font-mono text-[10px] tracking-wide text-fg-muted">
          {touchReveal ? "PASÁ EL MOUSE O EL DEDO PARA VER" : "PASÁ EL MOUSE PARA VER"}
        </span>
      )}
    </div>
  );
}
