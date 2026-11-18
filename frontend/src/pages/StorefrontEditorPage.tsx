import { type FormEvent, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, PageHeader, Spinner } from "../components/ui.tsx";
import { catalogApi, storefrontApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { formatDate, publicationLabel, storeUrl } from "../lib/format.ts";
import type { SectionKey, StorefrontContent } from "../lib/types.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

const SECTION_LABELS: Record<SectionKey, string> = {
  hero: "Portada",
  albums: "Galerías",
  about: "Sobre mí",
  contact: "Contacto",
};

function TextArea({
  label,
  value,
  onChange,
  rows = 4,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
}) {
  const id = `ta-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-mono text-xs uppercase tracking-wider text-fg-dim">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border-0 border-b border-line bg-raised px-3 py-2 text-fg focus:border-accent focus:outline-none"
      />
      {hint ? <p className="text-xs text-fg-dim">{hint}</p> : null}
    </div>
  );
}

export function StorefrontEditorPage() {
  const { currentStore } = useWorkspace();
  const storeId = currentStore?.id ?? "";
  const admin = useLoad(() => storefrontApi.get(storeId), [storeId]);
  const photos = useLoad(() => catalogApi.photos(storeId, {}), [storeId]);
  const [draft, setDraft] = useState<StorefrontContent | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (admin.data) {
      setDraft(admin.data.draft);
      setDirty(false);
    }
  }, [admin.data]);

  if (!currentStore || admin.loading || !draft) return <Spinner />;
  if (admin.error) return <Alert>{errorMessage(admin.error)}</Alert>;

  const canEdit = currentStore.role === "OWNER" || currentStore.role === "ADMIN";
  const url = storeUrl(currentStore.primaryHostname, window.location);

  function update<K extends keyof StorefrontContent>(key: K, value: StorefrontContent[K]) {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));
    setDirty(true);
  }

  function moveSection(index: number, delta: number) {
    if (!draft) return;
    const next = [...draft.sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [
      next[target] as (typeof next)[number],
      next[index] as (typeof next)[number],
    ];
    update("sections", next);
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!draft) return false;
    setSaving(true);
    setMessage(null);
    try {
      await storefrontApi.save(storeId, draft);
      setDirty(false);
      setMessage({
        tone: "ok",
        text: "Borrador guardado. La vitrina pública no cambia hasta que publiques.",
      });
      return true;
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setMessage(null);
    try {
      if (dirty && !(await save())) return;
      const result = await storefrontApi.publish(storeId);
      setMessage({ tone: "ok", text: `Publicado: versión ${result.publication.version}.` });
      admin.reload();
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    setPublishing(true);
    try {
      await storefrontApi.unpublish(storeId);
      setMessage({ tone: "ok", text: "La vitrina dejó de estar visible." });
      admin.reload();
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    } finally {
      setPublishing(false);
    }
  }

  const status = admin.data?.publicationStatus ?? "draft";
  const coverOptions = photos.data?.photos ?? [];

  return (
    <>
      <PageHeader title="Vitrina" subtitle="Lo que ven tus clientes en tu página pública." />

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-ui border border-line bg-surface p-4">
        <Badge tone={status === "published" ? "ok" : "warn"}>{publicationLabel(status)}</Badge>
        {admin.data?.published ? (
          <span className="text-sm text-fg-dim">
            Versión {admin.data.published.version} · {formatDate(admin.data.published.publishedAt)}
          </span>
        ) : (
          <span className="text-sm text-fg-dim">Todavía no publicaste tu vitrina.</span>
        )}
        {dirty ? <Badge tone="warn">Cambios sin guardar</Badge> : null}
        <div className="ml-auto flex flex-wrap gap-2">
          {url && status === "published" ? (
            <a
              className="rounded-ui border border-line px-4 py-2 text-sm text-fg-muted hover:border-accent"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              Ver vitrina
            </a>
          ) : null}
          {canEdit && status === "published" ? (
            <Button variant="ghost" onClick={() => void unpublish()} loading={publishing}>
              Ocultar
            </Button>
          ) : null}
          {canEdit ? (
            <Button onClick={() => void publish()} loading={publishing}>
              {status === "published" ? "Publicar cambios" : "Publicar vitrina"}
            </Button>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="mb-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}

      <form onSubmit={(event) => void save(event)} className="grid gap-4 lg:grid-cols-2">
        <fieldset disabled={!canEdit} className="contents">
          <Card title="Identidad">
            <div className="space-y-4">
              <Field
                label="Nombre visible"
                value={draft.displayName}
                required
                onChange={(e) => update("displayName", e.target.value)}
              />
              <Field
                label="Frase de portada"
                value={draft.tagline}
                placeholder="Fotografía de eventos y retratos"
                onChange={(e) => update("tagline", e.target.value)}
              />
              <TextArea
                label="Sobre mí"
                value={draft.bio}
                rows={6}
                onChange={(value) => update("bio", value)}
              />
              <div className="space-y-1">
                <label
                  htmlFor="cover"
                  className="block font-mono text-xs uppercase tracking-wider text-fg-dim"
                >
                  Foto de portada
                </label>
                <select
                  id="cover"
                  value={draft.coverPhotoId ?? ""}
                  onChange={(event) => update("coverPhotoId", event.target.value || null)}
                  className="w-full border-0 border-b border-line bg-raised px-3 py-2 text-fg focus:border-accent focus:outline-none"
                >
                  <option value="">Sin portada</option>
                  {coverOptions.map((photo) => (
                    <option key={photo.id} value={photo.id}>
                      {photo.title || photo.originalFilename}
                    </option>
                  ))}
                </select>
                {draft.coverPhotoId ? (
                  <img
                    alt="Portada elegida"
                    className="mt-2 h-28 w-full rounded-ui object-cover"
                    src={coverOptions.find((photo) => photo.id === draft.coverPhotoId)?.thumbUrl}
                  />
                ) : (
                  <p className="text-xs text-fg-dim">
                    Elegí una de las fotos que subiste en Catálogo.
                  </p>
                )}
              </div>
            </div>
          </Card>

          <Card title="Contacto">
            <div className="space-y-4">
              <Field
                label="Email de contacto"
                type="email"
                value={draft.contactEmail}
                onChange={(e) => update("contactEmail", e.target.value)}
              />
              <Field
                label="WhatsApp / teléfono"
                value={draft.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
              <Field
                label="Instagram"
                value={draft.instagram}
                placeholder="@tuestudio"
                onChange={(e) => update("instagram", e.target.value)}
              />
              <Field
                label="Sitio web"
                type="url"
                value={draft.website}
                placeholder="https://"
                onChange={(e) => update("website", e.target.value)}
              />
            </div>
          </Card>

          <Card title="Cobros">
            <div className="space-y-4">
              <TextArea
                label="Instrucciones de pago"
                value={draft.paymentInstructions}
                rows={5}
                hint="Se muestran al cliente al confirmar el pedido y van en el email. Ej.: alias, CBU, titular y a dónde mandar el comprobante."
                onChange={(value) => update("paymentInstructions", value)}
              />
              <Field
                label="Marca de agua"
                value={draft.watermarkText}
                hint="Texto sobre las vistas previas públicas. Se aplica a las fotos que subas desde ahora."
                onChange={(e) => update("watermarkText", e.target.value)}
              />
            </div>
          </Card>

          <Card title="Secciones">
            <ul className="divide-y divide-line">
              {draft.sections.map((section, index) => (
                <li key={section.key} className="flex items-center gap-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    id={`sec-${section.key}`}
                    checked={section.enabled}
                    onChange={(event) =>
                      update(
                        "sections",
                        draft.sections.map((item) =>
                          item.key === section.key
                            ? { ...item, enabled: event.target.checked }
                            : item,
                        ),
                      )
                    }
                  />
                  <label htmlFor={`sec-${section.key}`} className="flex-1 text-fg-muted">
                    {SECTION_LABELS[section.key]}
                  </label>
                  {admin.data?.canReorderSections ? (
                    <span className="flex gap-1">
                      <Button
                        variant="ghost"
                        className="px-2 py-1"
                        aria-label="Subir"
                        onClick={() => moveSection(index, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2 py-1"
                        aria-label="Bajar"
                        onClick={() => moveSection(index, 1)}
                      >
                        ↓
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {!admin.data?.canReorderSections ? (
              <p className="mt-3 text-xs text-fg-dim">
                Reordenar secciones está disponible en el plan Intermedio.
              </p>
            ) : null}
          </Card>

          <div className="lg:col-span-2">
            <Button type="submit" loading={saving} disabled={!dirty}>
              Guardar borrador
            </Button>
          </div>
        </fieldset>
      </form>
    </>
  );
}
