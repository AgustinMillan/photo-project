import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, PageHeader, Spinner } from "../components/ui.tsx";
import { catalogApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

/** Photos removed from the store. Kept so past buyers can still download them. */
export function RemovedPhotosPage() {
  const { currentStore } = useWorkspace();
  const storeId = currentStore?.id ?? "";
  const photos = useLoad(() => catalogApi.photos(storeId, { archived: true }), [storeId]);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (!currentStore) return <Spinner />;
  const list = photos.data?.photos ?? [];

  async function restore(photoId: string) {
    try {
      await catalogApi.updatePhoto(storeId, photoId, { status: "draft" });
      setMessage({
        tone: "ok",
        text: "Foto recuperada. Quedó oculta en su galería: toca “Mostrar” para que vuelva a verse.",
      });
      photos.reload();
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    }
  }

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/app/catalog" className="text-fg-dim hover:text-fg">
          ← Catálogo
        </Link>
      </p>
      <PageHeader
        title="Fotos quitadas"
        subtitle="No se ven en tu tienda. Siguen guardadas para quien ya las compró y las puedes recuperar."
      />
      {message ? (
        <div className="mb-4">
          <Alert tone={message.tone === "ok" ? "info" : "error"}>{message.text}</Alert>
        </div>
      ) : null}
      {photos.loading && !photos.data ? <Spinner /> : null}
      {photos.error ? <Alert>{errorMessage(photos.error)}</Alert> : null}
      {photos.data && list.length === 0 ? (
        <p className="text-sm text-fg-dim">No quitaste ninguna foto.</p>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {list.map((photo) => (
          <li key={photo.id} className="overflow-hidden rounded-ui border border-line bg-surface">
            <div className="aspect-square bg-raised">
              <img
                src={photo.thumbUrl}
                alt={photo.title}
                className="size-full object-cover opacity-60"
                loading="lazy"
              />
            </div>
            <div className="flex items-center justify-between gap-2 p-3 text-sm">
              <span className="truncate text-fg-muted">{photo.title || "Sin título"}</span>
              <button
                type="button"
                className="shrink-0 text-accent-soft hover:underline"
                onClick={() => void restore(photo.id)}
              >
                Recuperar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
