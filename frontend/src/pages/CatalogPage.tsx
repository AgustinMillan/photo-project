import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Card, Field, PageHeader, Spinner } from "../components/ui.tsx";
import { catalogApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { formatMoney, parsePesos } from "../lib/money.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

export function CatalogPage() {
  const { currentStore } = useWorkspace();
  const storeId = currentStore?.id ?? "";
  const albums = useLoad(() => catalogApi.albums(storeId), [storeId]);
  const loose = useLoad(() => catalogApi.photos(storeId, { unassigned: true }), [storeId]);
  const removed = useLoad(() => catalogApi.photos(storeId, { archived: true }), [storeId]);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    const priceCents = parsePesos(price);
    if (Number.isNaN(priceCents)) {
      setError("El precio tiene que ser un número mayor a cero.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await catalogApi.createAlbum(storeId, { title, priceCents });
      setTitle("");
      setPrice("");
      albums.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  if (!currentStore) return <Spinner />;

  return (
    <>
      <PageHeader title="Catálogo" subtitle="Tus galerías y fotos a la venta." />

      <Card title="Nueva galería">
        <form
          onSubmit={(event) => void create(event)}
          className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
        >
          <Field
            label="Nombre"
            value={title}
            required
            placeholder="Egresados 2026"
            onChange={(e) => setTitle(e.target.value)}
          />
          <Field
            label="Precio galería completa"
            value={price}
            inputMode="decimal"
            placeholder="Opcional"
            hint="Vacío: solo fotos sueltas"
            onChange={(e) => setPrice(e.target.value)}
          />
          <Button type="submit" loading={creating}>
            Crear
          </Button>
        </form>
        {error ? (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        ) : null}
      </Card>

      <div className="mt-6">
        {albums.loading ? <Spinner /> : null}
        {albums.error ? <Alert>{errorMessage(albums.error)}</Alert> : null}
        {albums.data && albums.data.albums.length === 0 ? (
          <p className="text-sm text-fg-dim">Todavía no creaste galerías. Empezá por una arriba.</p>
        ) : null}
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {albums.data?.albums.map((album) => (
            <li key={album.id}>
              <Link
                to={`/app/catalog/${album.id}`}
                className="group block overflow-hidden rounded-ui border border-line bg-surface transition-colors hover:border-accent"
              >
                <div className="aspect-[4/3] bg-raised">
                  {album.coverUrl ? (
                    <img
                      src={album.coverUrl}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-sm text-fg-dim">
                      Sin fotos
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-lg text-fg group-hover:text-accent-soft">
                      {album.title}
                    </h2>
                    <Badge tone={album.status === "published" ? "ok" : "neutral"}>
                      {album.status === "published" ? "Publicada" : "Borrador"}
                    </Badge>
                  </div>
                  <p className="text-xs text-fg-dim">
                    {album.photoCount} fotos · {album.publishedCount} visibles
                    {album.priceCents ? ` · Completa ${formatMoney(album.priceCents)}` : ""}
                  </p>
                </div>
              </Link>
            </li>
          ))}
          {loose.data && loose.data.photos.length > 0 ? (
            <li>
              <Link
                to="/app/catalog/sueltas"
                className="flex h-full min-h-40 flex-col justify-center rounded-ui border border-dashed border-line p-4 text-fg-muted hover:border-accent"
              >
                <span className="font-display text-lg">Fotos sin galería</span>
                <span className="text-xs text-fg-dim">{loose.data.photos.length} fotos</span>
              </Link>
            </li>
          ) : null}
        </ul>
        {removed.data && removed.data.photos.length > 0 ? (
          <p className="mt-6 text-sm">
            <Link to="/app/catalog/quitadas" className="text-fg-dim hover:text-fg">
              Fotos quitadas de la tienda ({removed.data.photos.length}) →
            </Link>
          </p>
        ) : null}
      </div>
    </>
  );
}
