import QRCode from "qrcode";
import { useEffect, useState } from "react";

const OPTIONS = {
  errorCorrectionLevel: "M" as const,
  margin: 2,
  color: { dark: "#000000", light: "#ffffff" },
};

function download(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * QR for a store, gallery or coupon link. Black on white with a quiet zone so it scans
 * when printed on stickers; PNG is 1200 px (≈10 cm at 300 dpi), SVG scales to any size.
 */
export function QrDownload({
  url,
  filename,
  label = "QR",
}: {
  url: string;
  filename: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    QRCode.toDataURL(url, { ...OPTIONS, width: 240 }).then((data) => {
      if (!cancelled) setPreview(data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  async function png() {
    download(await QRCode.toDataURL(url, { ...OPTIONS, width: 1200 }), `${filename}.png`);
  }

  async function svg() {
    const markup = await QRCode.toString(url, { ...OPTIONS, type: "svg" });
    const blobUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    download(blobUrl, `${filename}.svg`);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded-ui border border-line px-3 py-2 text-sm text-fg-muted hover:border-accent hover:text-fg"
        aria-expanded={open}
      >
        <span aria-hidden className="font-mono text-xs">
          ▦
        </span>
        {label}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-ui border border-line bg-surface p-4 shadow-xl">
          {preview ? (
            <img src={preview} alt={`Código QR de ${url}`} className="mx-auto size-40 rounded-ui" />
          ) : (
            <div className="mx-auto size-40 animate-pulse rounded-ui bg-raised" />
          )}
          <p className="mt-2 break-all text-center text-xs text-fg-dim">{url}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void png()}
              className="rounded-ui bg-accent px-3 py-2 text-xs font-medium text-void hover:bg-accent-soft"
            >
              Descargar PNG
            </button>
            <button
              type="button"
              onClick={() => void svg()}
              className="rounded-ui border border-line px-3 py-2 text-xs text-fg-muted hover:border-accent hover:text-fg"
            >
              Descargar SVG
            </button>
          </div>
          <p className="mt-2 text-xs text-fg-dim">
            PNG para imprimir stickers o compartir; SVG para imprenta (no pierde calidad).
          </p>
        </div>
      ) : null}
    </div>
  );
}
