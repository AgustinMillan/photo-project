import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { QrDownload } from "../components/QrDownload.tsx";
import { Alert, Badge, Button, Card, Field, PageHeader, Spinner } from "../components/ui.tsx";
import { catalogApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { storeUrl } from "../lib/format.ts";
import { centsToInput, formatMoney, parsePesos } from "../lib/money.ts";
import type { Photo } from "../lib/types.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

type UploadState = { total: number; done: number; failed: string[] };

export type PhotoEdit = {
  title?: string;
  priceCents?: number | null;
  status?: "published" | "draft";
};

function PhotoCard({
  photo,
  storeId,
  selected,
  onToggle,
  onChanged,
  isCover,
  onMakeCover,
  edit,
  onEdit,
}: {
  photo: Photo;
  storeId: string;
  selected: boolean;
  onToggle: () => void;
  onChanged: () => void;
  isCover: boolean;
  onMakeCover?: () => void;
  edit: PhotoEdit | undefined;
  onEdit: (change: PhotoEdit) => void;
}) {
  const title = edit?.title ?? photo.title;
  const status = edit?.status ?? photo.status;
  const priceCents = edit && "priceCents" in edit ? (edit.priceCents ?? null) : photo.priceCents;
  const [price, setPrice] = useState(centsToInput(priceCents));
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);

  async function patch(body: Parameters<typeof catalogApi.updatePhoto>[2]) {
    setError(null);
    try {
      await catalogApi.updatePhoto(storeId, photo.id, body);
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function savePrice() {
    const cents = parsePesos(price);
    if (Number.isNaN(cents)) return setError("Precio inválido");
    setError(null);
    if (cents !== priceCents) onEdit({ priceCents: cents });
  }

  async function replace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      await catalogApi.replace(storeId, photo.id, file);
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <li
      className={`overflow-hidden rounded-ui border bg-surface ${
        selected ? "border-accent" : edit ? "border-dashed border-accent/70" : "border-line"
      }`}
    >
      <div className="relative aspect-square bg-raised">
        <img
          src={photo.thumbUrl}
          alt={photo.title}
          className="size-full object-cover"
          loading="lazy"
        />
        <label className="absolute top-2 left-2 rounded-ui bg-void/80 px-2 py-1 text-xs">
          <input type="checkbox" checked={selected} onChange={onToggle} className="mr-1" />
          Elegir
        </label>
        <span className="absolute top-2 right-2">
          <Badge tone={status === "published" ? "ok" : "neutral"}>
            {status === "published" ? "Visible" : "Oculta"}
          </Badge>
        </span>
        {edit ? (
          <span className="absolute right-2 bottom-2">
            <Badge tone="warn">Sin guardar</Badge>
          </span>
        ) : null}
        {isCover ? (
          <span className="absolute bottom-2 left-2">
            <Badge tone="warn">Portada</Badge>
          </span>
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        <input
          aria-label="Título"
          value={title}
          onChange={(event) => onEdit({ title: event.target.value })}
          className="w-full border-0 border-b border-line bg-transparent px-1 py-1 text-sm text-fg focus:border-accent focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-dim">$</span>
          <input
            aria-label="Precio"
            inputMode="decimal"
            placeholder="Sin precio"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            onBlur={savePrice}
            className="w-full border-0 border-b border-line bg-transparent px-1 py-1 text-sm text-fg focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          <button
            type="button"
            className="text-accent-soft hover:underline"
            onClick={() => onEdit({ status: status === "published" ? "draft" : "published" })}
          >
            {status === "published" ? "Ocultar" : "Mostrar"}
          </button>
          {onMakeCover && !isCover ? (
            <button type="button" className="text-fg-dim hover:text-fg" onClick={onMakeCover}>
              · Portada
            </button>
          ) : null}
          <button
            type="button"
            className="text-fg-dim hover:text-fg"
            onClick={() => replaceInput.current?.click()}
          >
            · Reemplazar
          </button>
          <button
            type="button"
            className="text-danger/80 hover:text-danger"
            onClick={() => setConfirmRemove(true)}
          >
            · Quitar de la tienda
          </button>
          <input
            ref={replaceInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => void replace(event)}
          />
        </div>
        {confirmRemove ? (
          <div className="rounded-ui border border-danger/40 bg-danger/10 p-2 text-xs text-fg-muted">
            <p>
              Deja de verse en tu tienda. La foto queda guardada: quien ya la compró la puede seguir
              descargando, y la puedes recuperar en “Fotos quitadas”.
            </p>
            <div className="mt-2 flex gap-3">
              <button
                type="button"
                className="font-medium text-danger hover:underline"
                onClick={() => void patch({ status: "archived" })}
              >
                Sí, quitar
              </button>
              <button
                type="button"
                className="text-fg-dim hover:text-fg"
                onClick={() => setConfirmRemove(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
        {photo.version > 1 ? (
          <p className="text-[11px] text-fg-dim">Versión {photo.version}</p>
        ) : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </li>
  );
}

export function AlbumPage() {
  const { albumId = "" } = useParams();
  const navigate = useNavigate();
  const loose = albumId === "sueltas";
  const { currentStore } = useWorkspace();
  const storeId = currentStore?.id ?? "";
  const albums = useLoad(() => catalogApi.albums(storeId), [storeId]);
  const photos = useLoad(
    () => catalogApi.photos(storeId, loose ? { unassigned: true } : { albumId }),
    [storeId, albumId],
  );
  const album = albums.data?.albums.find((item) => item.id === albumId) ?? null;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [albumPrice, setAlbumPrice] = useState("");
  const [defaultPrice, setDefaultPrice] = useState("");
  const [publishOnUpload, setPublishOnUpload] = useState(true);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, PhotoEdit>>({});
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingCount = Object.keys(edits).length;

  // Warn before leaving the page with unsaved photo edits.
  useEffect(() => {
    if (pendingCount === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingCount]);

  useEffect(() => {
    if (album) {
      setTitle(album.title);
      setDescription(album.description);
      setAlbumPrice(centsToInput(album.priceCents));
    }
  }, [album]);

  // Only the first load shows a spinner; later refreshes keep the page in place.
  if (!currentStore || (albums.loading && !albums.data)) return <Spinner />;
  if (!loose && !album) {
    return (
      <Alert>
        No encontramos esta galería.{" "}
        <Link className="underline" to="/app/catalog">
          Volver
        </Link>
      </Alert>
    );
  }

  async function saveAlbum(extra: Parameters<typeof catalogApi.updateAlbum>[2] = {}) {
    const priceCents = parsePesos(albumPrice);
    if (Number.isNaN(priceCents)) {
      setMessage({ tone: "error", text: "El precio de la galería es inválido." });
      return;
    }
    try {
      await catalogApi.updateAlbum(storeId, albumId, { title, description, priceCents, ...extra });
      setMessage({ tone: "ok", text: "Galería guardada." });
      albums.reload();
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    }
  }

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const priceCents = parsePesos(defaultPrice);
    if (Number.isNaN(priceCents)) {
      setMessage({ tone: "error", text: "El precio por foto es inválido." });
      return;
    }
    const state: UploadState = { total: files.length, done: 0, failed: [] };
    setUpload({ ...state });
    for (const file of files) {
      try {
        await catalogApi.upload(storeId, file, {
          albumId: loose ? undefined : albumId,
          priceCents,
          status: publishOnUpload ? "published" : "draft",
        });
      } catch (caught) {
        state.failed.push(`${file.name}: ${errorMessage(caught)}`);
      }
      state.done += 1;
      setUpload({ ...state });
    }
    photos.reload();
    albums.reload();
  }

  async function bulk(body: {
    status?: "published" | "draft" | "archived";
    priceCents?: number | null;
  }) {
    if (
      body.status === "archived" &&
      !window.confirm(
        `¿Quitar ${selected.size} fotos de la tienda? Quedan guardadas: quien ya las compró las puede seguir descargando y las puedes recuperar en “Fotos quitadas”.`,
      )
    )
      return;
    try {
      const result = await catalogApi.bulkPhotos(storeId, { photoIds: [...selected], ...body });
      setMessage({ tone: "ok", text: `${result.updated} fotos actualizadas.` });
      setSelected(new Set());
      photos.reload();
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    }
  }

  async function remove(mode: "release" | "archive") {
    const text =
      mode === "release"
        ? "¿Eliminar la galería? Las fotos quedan en el catálogo, sin galería."
        : "¿Archivar la galería y todas sus fotos? Dejan de verse en la vitrina.";
    if (!window.confirm(text)) return;
    try {
      await catalogApi.removeAlbum(storeId, albumId, mode);
      navigate("/app/catalog");
    } catch (caught) {
      setMessage({ tone: "error", text: errorMessage(caught) });
    }
  }

  function editPhoto(photo: Photo, change: PhotoEdit) {
    setEdits((previous) => {
      const merged: PhotoEdit = { ...previous[photo.id], ...change };
      // Drop fields that went back to the saved value.
      if (merged.title !== undefined && merged.title === photo.title) delete merged.title;
      if (merged.status !== undefined && merged.status === photo.status) delete merged.status;
      if ("priceCents" in merged && merged.priceCents === photo.priceCents)
        delete merged.priceCents;
      const next = { ...previous };
      if (Object.keys(merged).length === 0) delete next[photo.id];
      else next[photo.id] = merged;
      return next;
    });
  }

  async function saveEdits() {
    setSaving(true);
    setMessage(null);
    const entries = Object.entries(edits);
    const failed: string[] = [];
    const remaining: Record<string, PhotoEdit> = {};
    for (const [photoId, change] of entries) {
      try {
        await catalogApi.updatePhoto(storeId, photoId, change);
      } catch (caught) {
        failed.push(errorMessage(caught));
        remaining[photoId] = change;
      }
    }
    setEdits(remaining);
    setSaving(false);
    photos.reload();
    albums.reload();
    setMessage(
      failed.length === 0
        ? {
            tone: "ok",
            text: `Guardamos los cambios de ${entries.length} ${entries.length === 1 ? "foto" : "fotos"}.`,
          }
        : { tone: "error", text: `No pudimos guardar ${failed.length} fotos: ${failed[0]}` },
    );
  }

  const list = photos.data?.photos ?? [];
  const base = currentStore ? storeUrl(currentStore.primaryHostname, window.location) : null;
  const galleryUrl = base ? `${base}/galeria/${albumId}` : null;
  const uploading = upload !== null && upload.done < upload.total;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/app/catalog" className="text-fg-dim hover:text-fg">
          ← Catálogo
        </Link>
      </p>
      <PageHeader
        title={loose ? "Fotos sin galería" : (album?.title ?? "")}
        action={
          !loose && album && galleryUrl ? (
            <QrDownload
              url={galleryUrl}
              filename={`qr-galeria-${album.title}`}
              label="QR de la galería"
            />
          ) : undefined
        }
      />
      {!loose && album && galleryUrl && album.status !== "published" ? (
        <p className="-mt-4 mb-4 text-xs text-fg-dim">
          El QR funciona cuando la galería esté publicada.
        </p>
      ) : null}

      {message ? (
        <div className="mb-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {!loose && album ? (
          <Card
            title="Galería"
            action={
              <Badge tone={album.status === "published" ? "ok" : "neutral"}>
                {album.status === "published" ? "Publicada" : "Borrador"}
              </Badge>
            }
          >
            <div className="space-y-4">
              <Field label="Nombre" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Field
                label="Descripción"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <Field
                label="Precio galería completa"
                value={albumPrice}
                inputMode="decimal"
                placeholder="Vacío: no se vende completa"
                hint={album.priceCents ? `Actual: ${formatMoney(album.priceCents)}` : undefined}
                onChange={(e) => setAlbumPrice(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void saveAlbum()}>Guardar</Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void saveAlbum({ status: album.status === "published" ? "draft" : "published" })
                  }
                >
                  {album.status === "published" ? "Pasar a borrador" : "Publicar galería"}
                </Button>
                <Button variant="danger" onClick={() => void remove("release")}>
                  Eliminar
                </Button>
                <Button variant="danger" onClick={() => void remove("archive")}>
                  Archivar con fotos
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        <Card title="Subir fotos">
          <div className="space-y-4">
            <Field
              label="Precio por foto"
              value={defaultPrice}
              inputMode="decimal"
              placeholder="Opcional"
              hint="Se aplica a las fotos de esta subida. Después lo podés cambiar foto por foto."
              onChange={(e) => setDefaultPrice(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={publishOnUpload}
                onChange={(e) => setPublishOnUpload(e.target.checked)}
              />
              Mostrar en la vitrina al subir
            </label>
            <Button onClick={() => fileInput.current?.click()} loading={uploading}>
              Elegir fotos
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/tiff"
              multiple
              hidden
              onChange={(event) => void onFiles(event)}
            />
            {upload ? (
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${(upload.done / upload.total) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-fg-dim">
                  {upload.done} de {upload.total} procesadas
                  {upload.failed.length ? ` · ${upload.failed.length} con error` : ""}
                </p>
                {upload.failed.map((failure) => (
                  <p key={failure} className="text-xs text-danger">
                    {failure}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-xs text-fg-dim">
                JPEG, PNG, WebP, HEIC o TIFF. El original queda privado; en la vitrina se ve una
                copia con marca de agua y sin datos EXIF.
              </p>
            )}
          </div>
        </Card>
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-0 z-10 mt-6 flex flex-wrap items-center gap-2 rounded-ui border border-accent/50 bg-overlay p-3 text-sm">
          <span>{selected.size} elegidas</span>
          <Button variant="ghost" onClick={() => void bulk({ status: "published" })}>
            Mostrar
          </Button>
          <Button variant="ghost" onClick={() => void bulk({ status: "draft" })}>
            Ocultar
          </Button>
          <Button variant="ghost" onClick={() => void bulk({ status: "archived" })}>
            Quitar de la tienda
          </Button>
          <input
            aria-label="Precio para las elegidas"
            placeholder="Precio"
            inputMode="decimal"
            value={bulkPrice}
            onChange={(event) => setBulkPrice(event.target.value)}
            className="w-28 border-0 border-b border-line bg-transparent px-2 py-1 focus:border-accent focus:outline-none"
          />
          <Button
            variant="ghost"
            onClick={() => {
              const cents = parsePesos(bulkPrice);
              if (Number.isNaN(cents))
                return setMessage({ tone: "error", text: "Precio inválido" });
              void bulk({ priceCents: cents });
            }}
          >
            Aplicar precio
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Cancelar
          </Button>
        </div>
      ) : null}

      <div className="mt-6">
        {photos.loading && !photos.data ? <Spinner /> : null}
        {list.length === 0 && !photos.loading ? (
          <p className="text-sm text-fg-dim">No hay fotos todavía.</p>
        ) : (
          <div className="mb-3 flex items-center gap-3 text-xs text-fg-dim">
            <span>{list.length} fotos</span>
            <button
              type="button"
              className="text-accent-soft hover:underline"
              onClick={() => setSelected(new Set(list.map((p) => p.id)))}
            >
              Elegir todas
            </button>
          </div>
        )}
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {list.map((photo) => (
            <PhotoCard
              key={`${photo.id}-${photo.version}-${edits[photo.id] ? "edit" : `${photo.status}-${photo.priceCents}`}`}
              photo={photo}
              edit={edits[photo.id]}
              onEdit={(change) => editPhoto(photo, change)}
              storeId={storeId}
              selected={selected.has(photo.id)}
              isCover={album?.coverPhotoId === photo.id}
              onMakeCover={loose ? undefined : () => void saveAlbum({ coverPhotoId: photo.id })}
              onToggle={() =>
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (next.has(photo.id)) next.delete(photo.id);
                  else next.add(photo.id);
                  return next;
                })
              }
              onChanged={() => {
                photos.reload();
                albums.reload();
              }}
            />
          ))}
        </ul>
      </div>

      {pendingCount > 0 ? (
        <div className="sticky bottom-4 z-20 mt-6 flex flex-wrap items-center gap-3 rounded-ui border border-accent/60 bg-overlay p-3 text-sm shadow-lg shadow-black/40">
          <span className="text-fg">
            {pendingCount} {pendingCount === 1 ? "foto con cambios" : "fotos con cambios"} sin
            guardar
          </span>
          <Button loading={saving} onClick={() => void saveEdits()}>
            Guardar cambios
          </Button>
          <Button variant="ghost" disabled={saving} onClick={() => setEdits({})}>
            Descartar
          </Button>
        </div>
      ) : null}
    </>
  );
}
