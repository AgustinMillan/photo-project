import { type FormEvent, type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ApiError } from "../lib/api.ts";
import { serviceContactUrl } from "../lib/contact.ts";
import { shopApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { formatMoney } from "../lib/money.ts";
import { applyCachedTheme, applyThemeToDocument } from "../lib/theme.ts";
import type {
  CouponCheck,
  PhotoProtection,
  Promotion,
  PublicPhoto,
  PublicStorefront,
} from "../lib/types.ts";
import { useLoad } from "../lib/useLoad.ts";
import { trackVisit } from "../lib/visit.ts";
import { CartProvider, useCart } from "./cart.tsx";
import { ProtectedImage } from "./ProtectedImage.tsx";

function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status">
      <span className="size-6 animate-spin rounded-full border-2 border-line border-t-accent" />
    </div>
  );
}

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-4xl text-fg">{title}</h1>
      {children ? <div className="mt-4 max-w-md text-fg-dim">{children}</div> : null}
    </main>
  );
}

const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN || "localhost";

function platformSignupUrl(): string {
  const scheme = window.location.protocol === "http:" ? "http:" : "https:";
  return `${scheme}//${PLATFORM_DOMAIN}/register?utm_source=tienda-ejemplo&utm_medium=referral`;
}

function DemoBanner() {
  return (
    <div className="bg-accent px-5 py-2 text-center text-sm text-on-accent">
      Esta es una tienda de ejemplo hecha con Galeriza.{" "}
      <a href={platformSignupUrl()} className="font-medium underline underline-offset-2">
        Creá la tuya gratis →
      </a>
    </div>
  );
}

function DemoCheckout() {
  return (
    <div className="mt-8 rounded-ui border border-accent/50 bg-surface p-5">
      <h2 className="font-display text-xl">Así compran tus clientes</h2>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
        En una tienda real, acá tu cliente deja su nombre y email, paga con Mercado Pago y recibe al
        instante el link para descargar sus fotos en alta resolución, sin marca de agua. Vos no
        tenés que hacer nada: la plata va directo a tu cuenta.
      </p>
      <p className="mt-2 text-sm text-fg-dim">
        Esta tienda es de ejemplo, así que no se cobra nada.
      </p>
      <a
        href={platformSignupUrl()}
        className="mt-4 inline-block rounded-ui bg-accent px-5 py-2.5 text-sm font-medium text-on-accent hover:bg-accent-soft"
      >
        Crear mi tienda gratis
      </a>
    </div>
  );
}

function scopeText(appliesTo: Promotion["appliesTo"]): string {
  if (appliesTo === "photos") return " en fotos sueltas";
  if (appliesTo === "albums") return " en galerías completas";
  return "";
}

function PromotionBanner({ promotions }: { promotions: Promotion[] }) {
  const [saved, setSaved] = useState(() => readSavedCoupon());
  const promo = promotions[0];
  if (!promo) return null;
  const until = promo.endsAt
    ? ` hasta el ${new Date(promo.endsAt).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}`
    : "";
  return (
    <div className="border-b border-accent/30 bg-accent/10 px-5 py-2 text-center text-sm text-fg">
      <span className="text-accent">−{promo.percentOff}%</span>
      {scopeText(promo.appliesTo)}
      {until} con el código <strong className="font-mono">{promo.code}</strong>{" "}
      {saved === promo.code ? (
        <span className="ml-2 text-xs text-ok">✓ se aplica en el carrito</span>
      ) : (
        <button
          type="button"
          className="ml-2 rounded-ui border border-accent/50 px-2 py-0.5 text-xs hover:bg-accent/20"
          onClick={() => {
            saveCoupon(promo.code);
            setSaved(promo.code);
          }}
        >
          Usar
        </button>
      )}
    </div>
  );
}

function Shell({ data, children }: { data: PublicStorefront; children: ReactNode }) {
  const cart = useCart();
  // A shared link like tienda/?cupon=VERANO2027 pre-loads the code for the cart.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("cupon");
    if (code) saveCoupon(code.trim().toUpperCase());
  }, []);
  return (
    <div className="min-h-screen">
      {data.store.isDemo ? <DemoBanner /> : null}
      {!data.store.isDemo && data.store.purchasesEnabled && data.promotions?.length ? (
        <PromotionBanner promotions={data.promotions} />
      ) : null}
      <header className="sticky top-0 z-20 border-b border-line/60 bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="font-display text-xl text-fg">
            {data.content.displayName}
          </Link>
          <Link
            to="/carrito"
            className="rounded-ui border border-line px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-fg-muted hover:border-accent"
          >
            Carrito {cart.count ? <span className="text-accent">({cart.count})</span> : null}
          </Link>
        </div>
      </header>
      {children}
      <footer className="mt-24 border-t border-line/60 px-5 py-8 text-center text-xs text-fg-dim">
        © {new Date().getFullYear()} {data.content.displayName}
        {data.store.isDemo ? (
          <p className="mt-2">Fotos de ejemplo de dominio público (CC0), vía Wikimedia Commons.</p>
        ) : null}
      </footer>
    </div>
  );
}

function PhotoGrid({
  photos,
  purchasesEnabled,
  coveredByAlbum,
  protection,
}: {
  photos: PublicPhoto[];
  purchasesEnabled: boolean;
  coveredByAlbum?: boolean;
  protection?: PhotoProtection;
}) {
  const cart = useCart();
  const [open, setOpen] = useState<PublicPhoto | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <ul className="columns-2 gap-3 md:columns-3 xl:columns-4">
        {photos.map((photo) => {
          const inCart = cart.has(photo.id);
          return (
            <li
              key={photo.id}
              className="mb-3 break-inside-avoid overflow-hidden rounded-ui border border-line/60 bg-surface"
            >
              <button type="button" className="block w-full" onClick={() => setOpen(photo)}>
                <ProtectedImage
                  src={photo.thumbUrl}
                  alt={photo.title}
                  loading="lazy"
                  reveal={Boolean(protection?.grid.reveal)}
                  radius={60}
                  className="block w-full"
                  imgClassName="block w-full"
                />
              </button>
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate text-fg-muted">{photo.title}</span>
                {purchasesEnabled && photo.priceCents && !coveredByAlbum ? (
                  <button
                    type="button"
                    onClick={() =>
                      inCart
                        ? cart.remove(photo.id)
                        : cart.add({
                            type: "photo",
                            id: photo.id,
                            title: photo.title || "Fotografía",
                            priceCents: photo.priceCents ?? 0,
                            thumbUrl: photo.thumbUrl,
                            albumId: photo.albumId,
                          })
                    }
                    className={`shrink-0 rounded-ui px-2 py-1 font-mono text-xs ${inCart ? "bg-accent text-on-accent" : "border border-line text-fg-muted hover:border-accent"}`}
                  >
                    {inCart ? "En carrito" : formatMoney(photo.priceCents)}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={open.title || "Vista previa"}
          className="fixed inset-0 z-30 flex items-center justify-center bg-void/95 p-4"
          onClick={() => setOpen(null)}
          onKeyDown={() => undefined}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: keeps clicks on the photo from closing the dialog */}
          <div onClick={(event) => event.stopPropagation()} onKeyDown={() => undefined}>
            <ProtectedImage
              src={open.previewUrl}
              alt={open.title}
              reveal={Boolean(protection?.full.reveal)}
              radius={110}
              touchReveal
              className="inline-block"
              imgClassName="block max-h-[90vh] max-w-[calc(100vw-2rem)] object-contain"
            />
          </div>
          <button
            type="button"
            className="absolute top-4 right-4 font-mono text-sm text-fg-muted"
            onClick={() => setOpen(null)}
          >
            Cerrar ✕
          </button>
        </div>
      ) : null}
    </>
  );
}

function HomePage({ data }: { data: PublicStorefront }) {
  const { content } = data;
  const sections = content.sections.filter((section) => section.enabled);

  const render: Record<string, ReactNode> = {
    hero: (
      <section key="hero" className="relative flex min-h-[70vh] items-end overflow-hidden">
        {content.coverUrl ? (
          <img
            src={content.coverUrl}
            alt=""
            className="hero-cover absolute inset-0 size-full object-cover opacity-60"
          />
        ) : (
          <div className="hero-fallback absolute inset-0 bg-gradient-to-br from-overlay via-surface to-void" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-void via-void/40 to-transparent" />
        <div className="relative mx-auto w-full max-w-6xl px-5 pb-16">
          <h1 className="font-display text-5xl text-fg md:text-7xl">{content.displayName}</h1>
          {content.tagline ? (
            <p className="mt-4 max-w-2xl text-lg text-fg-muted">{content.tagline}</p>
          ) : null}
        </div>
      </section>
    ),
    services: content.services.length ? (
      <section key="services" className="mx-auto max-w-6xl px-5 pt-16">
        <h2 className="mb-6 font-mono text-xs uppercase tracking-[0.3em] text-accent">Servicios</h2>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {content.services.map((service) => {
            const contact = serviceContactUrl(content, service.title);
            return (
              <li
                key={service.id}
                className="flex flex-col overflow-hidden rounded-ui border border-line/60 bg-surface"
              >
                {service.coverUrl ? (
                  <img
                    src={service.coverUrl}
                    alt=""
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : null}
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <h3 className="font-display text-xl text-fg">{service.title}</h3>
                  {service.description ? (
                    <p className="whitespace-pre-line text-sm leading-relaxed text-fg-muted">
                      {service.description}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                    <span className="text-sm text-fg">
                      {service.priceFromCents
                        ? `Desde ${formatMoney(service.priceFromCents)}`
                        : "A consultar"}
                    </span>
                    {contact ? (
                      <a
                        href={contact}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-ui border border-accent px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-accent hover:bg-accent hover:text-on-accent"
                      >
                        Consultar
                      </a>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    ) : null,
    albums:
      data.albums.length || data.photos.length ? (
        <section key="albums" className="mx-auto max-w-6xl px-5 pt-16">
          <h2 className="mb-6 font-mono text-xs uppercase tracking-[0.3em] text-accent">
            Galerías
          </h2>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.albums.map((album) => (
              <li key={album.id}>
                <Link to={`/galeria/${album.id}`} className="group block">
                  <div className="aspect-[4/5] overflow-hidden rounded-ui bg-surface">
                    {album.coverUrl ? (
                      <img
                        src={album.coverUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : null}
                  </div>
                  <h3 className="mt-3 font-display text-xl text-fg group-hover:text-accent-soft">
                    {album.title}
                  </h3>
                  <p className="text-xs text-fg-dim">
                    {album.photoCount} fotos
                    {album.priceCents ? ` · Completa ${formatMoney(album.priceCents)}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          {data.photos.length ? (
            <div className="mt-12">
              <h3 className="mb-4 font-display text-xl">Fotos</h3>
              <PhotoGrid
                photos={data.photos}
                purchasesEnabled={data.store.purchasesEnabled}
                protection={data.content.protection}
              />
            </div>
          ) : null}
        </section>
      ) : null,
    about: content.bio ? (
      <section key="about" className="mx-auto max-w-3xl px-5 pt-20">
        <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-accent">Sobre mí</h2>
        <p className="whitespace-pre-line text-lg leading-relaxed text-fg-muted">{content.bio}</p>
      </section>
    ) : null,
    contact:
      content.contactEmail || content.phone || content.instagram || content.website ? (
        <section key="contact" className="mx-auto max-w-3xl px-5 pt-20">
          <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-accent">
            Contacto
          </h2>
          <ul className="space-y-2 text-fg-muted">
            {content.contactEmail ? (
              <li>
                <a className="hover:text-accent-soft" href={`mailto:${content.contactEmail}`}>
                  {content.contactEmail}
                </a>
              </li>
            ) : null}
            {content.phone ? (
              <li>
                <a
                  className="hover:text-accent-soft"
                  href={`https://wa.me/${content.phone.replace(/\D/g, "")}`}
                >
                  {content.phone}
                </a>
              </li>
            ) : null}
            {content.instagram ? (
              <li>
                <a
                  className="hover:text-accent-soft"
                  href={`https://instagram.com/${content.instagram.replace(/^@/, "")}`}
                >
                  @{content.instagram.replace(/^@/, "")}
                </a>
              </li>
            ) : null}
            {content.website ? (
              <li>
                <a className="hover:text-accent-soft" href={content.website} rel="noreferrer">
                  {content.website}
                </a>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null,
  };

  return <>{sections.map((section) => render[section.key])}</>;
}

function AlbumView({ purchasesEnabled }: { purchasesEnabled: boolean }) {
  const { albumId = "" } = useParams();
  const cart = useCart();
  const album = useLoad(() => shopApi.album(albumId), [albumId]);

  if (album.loading) return <Loading />;
  if (album.error || !album.data) return <Notice title="Galería no disponible" />;
  const { album: info, photos } = album.data;
  const canBuy = purchasesEnabled && album.data.purchasesEnabled;
  const albumInCart = cart.has(info.id);

  return (
    <main className="mx-auto max-w-6xl px-5 pt-10">
      <Link to="/" className="font-mono text-xs uppercase tracking-wider text-fg-dim hover:text-fg">
        ← Volver
      </Link>
      <div className="mt-4 mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl text-fg">{info.title}</h1>
          {info.description ? (
            <p className="mt-2 max-w-2xl text-fg-muted">{info.description}</p>
          ) : null}
        </div>
        {canBuy && info.priceCents ? (
          <button
            type="button"
            onClick={() =>
              albumInCart
                ? cart.remove(info.id)
                : cart.add({
                    type: "album",
                    id: info.id,
                    title: info.title,
                    priceCents: info.priceCents ?? 0,
                    thumbUrl: photos[0]?.thumbUrl ?? null,
                    albumId: null,
                  })
            }
            className={`rounded-ui px-5 py-3 text-sm font-medium ${albumInCart ? "border border-accent text-accent" : "bg-accent text-on-accent hover:bg-accent-soft"}`}
          >
            {albumInCart
              ? "Galería en el carrito ✓"
              : `Comprar galería completa · ${formatMoney(info.priceCents)}`}
          </button>
        ) : null}
      </div>
      {!canBuy ? (
        <p className="mb-6 text-sm text-fg-dim">
          Las compras no están disponibles en este momento.
        </p>
      ) : null}
      <PhotoGrid
        photos={photos}
        purchasesEnabled={canBuy}
        coveredByAlbum={albumInCart}
        protection={album.data.protection}
      />
    </main>
  );
}

const COUPON_KEY = "galeriza-coupon";

function readSavedCoupon(): string {
  try {
    return sessionStorage.getItem(COUPON_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveCoupon(code: string) {
  try {
    if (code) sessionStorage.setItem(COUPON_KEY, code);
    else sessionStorage.removeItem(COUPON_KEY);
  } catch {
    // Storage unavailable: the buyer can type the code in the cart.
  }
}

function CartPage({ data }: { data: PublicStorefront }) {
  const cart = useCart();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = data.store.payments;
  const [method, setMethod] = useState<"mercadopago" | "transfer">(
    options.mercadopago ? "mercadopago" : "transfer",
  );

  const payableItems = cart.items
    .filter((item) => !cart.isCovered(item))
    .map((item) => ({ type: item.type, id: item.id }));
  const itemsKey = payableItems.map((item) => item.id).join(",");
  const [couponInput, setCouponInput] = useState(() => readSavedCoupon());
  const [coupon, setCoupon] = useState<CouponCheck | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const totalCents = coupon ? coupon.totalCents : cart.totalCents;

  async function applyCoupon(code: string) {
    const clean = code.trim().toUpperCase();
    if (!clean || payableItems.length === 0) return;
    setChecking(true);
    setCouponError(null);
    try {
      setCoupon(await shopApi.checkCoupon({ code: clean, items: payableItems }));
      saveCoupon(clean);
    } catch (caught) {
      setCoupon(null);
      setCouponError(errorMessage(caught));
    } finally {
      setChecking(false);
    }
  }

  // Re-price the coupon whenever the cart changes (also applies a code saved from the banner).
  // biome-ignore lint/correctness/useExhaustiveDependencies: itemsKey captures the cart contents.
  useEffect(() => {
    const code = coupon?.code ?? readSavedCoupon();
    if (code) void applyCoupon(code);
  }, [itemsKey]);

  function dropCoupon() {
    setCoupon(null);
    setCouponInput("");
    setCouponError(null);
    saveCoupon("");
  }

  async function checkout(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { order } = await shopApi.checkout({
        customerName: name,
        customerEmail: email,
        paymentMethod: method,
        items: payableItems,
        ...(coupon ? { couponCode: coupon.code } : {}),
      });
      saveCoupon("");
      cart.clear();
      const orderPath = `/pedido/${order.orderId}?token=${encodeURIComponent(order.accessToken)}&nuevo=1`;
      if (order.paymentMethod === "mercadopago") {
        try {
          const { url } = await shopApi.mercadoPagoCheckout(order.orderId, order.accessToken);
          window.location.assign(url);
          return;
        } catch {
          // The order exists; the order page offers to retry the payment.
        }
      }
      navigate(orderPath);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "ITEMS_UNAVAILABLE") {
        const ids = (caught.details as { ids?: string[] } | undefined)?.ids ?? [];
        cart.removeMany(ids);
        setError(
          "Algunas fotos ya no están disponibles y las quitamos del carrito. Revisá el total y volvé a confirmar.",
        );
      } else if (caught instanceof ApiError && caught.code.startsWith("COUPON_")) {
        setCoupon(null);
        setCouponError(errorMessage(caught));
        setError("El cupón ya no se puede usar. Revisá el total y volvé a confirmar.");
      } else if (caught instanceof ApiError && caught.code === "STORE_PURCHASES_DISABLED") {
        setError("Este estudio no está aceptando compras en este momento.");
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-5 pt-10">
      <h1 className="font-display text-4xl text-fg">Tu carrito</h1>
      {cart.count === 0 ? (
        <p className="mt-6 text-fg-dim">
          Está vacío.{" "}
          <Link to="/" className="text-accent-soft underline">
            Ver galerías
          </Link>
        </p>
      ) : (
        <>
          <ul className="mt-6 divide-y divide-line rounded-ui border border-line">
            {cart.items.map((item) => (
              <li key={item.id} className="flex items-center gap-4 p-3">
                {item.thumbUrl ? (
                  <img src={item.thumbUrl} alt="" className="size-16 rounded-ui object-cover" />
                ) : (
                  <div className="size-16 rounded-ui bg-raised" />
                )}
                <div className="flex-1 text-sm">
                  <p className="text-fg">
                    {item.type === "album" ? `Galería completa: ${item.title}` : item.title}
                  </p>
                  {cart.isCovered(item) ? (
                    <p className="text-xs text-ok">Incluida en la galería del carrito</p>
                  ) : null}
                </div>
                <span className="text-sm">
                  {cart.isCovered(item) ? "—" : formatMoney(item.priceCents)}
                </span>
                <button
                  type="button"
                  className="text-xs text-fg-dim hover:text-danger"
                  onClick={() => cart.remove(item.id)}
                >
                  Quitar
                </button>
              </li>
            ))}
            {coupon ? (
              <>
                <li className="flex justify-between p-3 text-sm text-fg-muted">
                  <span>Subtotal</span>
                  <span>{formatMoney(coupon.subtotalCents)}</span>
                </li>
                <li className="flex items-center justify-between gap-3 p-3 text-sm text-ok">
                  <span>
                    Cupón {coupon.code} (−{coupon.percentOff}%{scopeText(coupon.appliesTo)}){" "}
                    <button
                      type="button"
                      className="ml-2 text-xs text-fg-dim hover:text-danger"
                      onClick={dropCoupon}
                    >
                      Quitar
                    </button>
                  </span>
                  <span>−{formatMoney(coupon.discountCents)}</span>
                </li>
              </>
            ) : null}
            <li className="flex justify-between p-3 font-medium">
              <span>Total</span>
              <span>{formatMoney(totalCents)}</span>
            </li>
          </ul>

          {!data.store.isDemo && data.store.purchasesEnabled && !coupon ? (
            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void applyCoupon(couponInput);
              }}
            >
              <input
                aria-label="Código de descuento"
                placeholder="¿Tenés un cupón?"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                className="flex-1 border-0 border-b border-line bg-raised px-3 py-2 font-mono text-sm uppercase focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={checking || !couponInput.trim()}
                className="rounded-ui border border-line px-4 py-2 text-sm text-fg-muted hover:border-accent hover:text-fg disabled:opacity-50"
              >
                {checking ? "Revisando…" : "Aplicar"}
              </button>
            </form>
          ) : null}
          {couponError && !coupon ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {couponError}
            </p>
          ) : null}

          {data.store.isDemo ? (
            <DemoCheckout />
          ) : data.store.purchasesEnabled ? (
            <form
              onSubmit={(event) => void checkout(event)}
              className="mt-8 space-y-4 rounded-ui border border-line bg-surface p-5"
            >
              <h2 className="font-display text-xl">Tus datos</h2>
              <p className="text-sm text-fg-dim">
                {method === "mercadopago"
                  ? "Vas a pagar en Mercado Pago. Apenas se apruebe el pago, te llegan las fotos en alta resolución por email."
                  : "Te enviamos por email los datos para transferir. Cuando el estudio confirme el pago, vas a poder descargar las fotos en alta resolución."}
              </p>
              <input
                required
                minLength={2}
                placeholder="Nombre y apellido"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border-0 border-b border-line bg-raised px-3 py-2 focus:border-accent focus:outline-none"
              />
              <input
                required
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border-0 border-b border-line bg-raised px-3 py-2 focus:border-accent focus:outline-none"
              />
              {options.mercadopago && options.transfer ? (
                <fieldset className="space-y-2">
                  <legend className="mb-1 font-mono text-xs uppercase tracking-wider text-fg-dim">
                    Forma de pago
                  </legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="method"
                      checked={method === "mercadopago"}
                      onChange={() => setMethod("mercadopago")}
                    />
                    Mercado Pago (tarjeta, dinero en cuenta) · entrega inmediata
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="method"
                      checked={method === "transfer"}
                      onChange={() => setMethod("transfer")}
                    />
                    Transferencia bancaria · el estudio confirma el pago
                  </label>
                </fieldset>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-ui bg-accent px-5 py-3 font-medium text-on-accent hover:bg-accent-soft disabled:opacity-50"
              >
                {busy
                  ? "Enviando…"
                  : method === "mercadopago"
                    ? `Pagar con Mercado Pago · ${formatMoney(totalCents)}`
                    : `Confirmar pedido · ${formatMoney(totalCents)}`}
              </button>
            </form>
          ) : (
            <p className="mt-6 text-sm text-fg-dim">
              Este estudio no está aceptando compras en este momento.
            </p>
          )}
        </>
      )}
    </main>
  );
}

function OrderPage() {
  const { orderId = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const isNew = params.get("nuevo") === "1";
  const returnedFromMp = params.get("mp") === "1";
  const [polls, setPolls] = useState(0);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const order = useLoad(
    // Coming back from Mercado Pago, pull the payment status before showing the page.
    () =>
      returnedFromMp || polls > 0
        ? shopApi.mercadoPagoSync(orderId, token)
        : shopApi.order(orderId, token),
    [orderId, token, polls],
  );
  const pendingMp =
    order.data?.order.status === "pending_payment" &&
    order.data.order.paymentMethod === "mercadopago";

  useEffect(() => {
    // The approval can take a few seconds to reach us; check again for about a minute.
    if (!pendingMp || !returnedFromMp || polls >= 12) return;
    const timer = window.setTimeout(() => setPolls((value) => value + 1), 5000);
    return () => window.clearTimeout(timer);
  }, [pendingMp, returnedFromMp, polls]);

  async function payWithMercadoPago() {
    setPaying(true);
    setPayError(null);
    try {
      const { url } = await shopApi.mercadoPagoCheckout(orderId, token);
      window.location.assign(url);
    } catch (caught) {
      setPayError(errorMessage(caught));
      setPaying(false);
    }
  }

  if (order.loading && !order.data) return <Loading />;
  if (order.error || !order.data) {
    return (
      <Notice title="Pedido no encontrado">
        Revisá que el enlace esté completo, tal como te llegó por email.
      </Notice>
    );
  }
  const { order: info, items, downloads } = order.data;

  return (
    <main className="mx-auto max-w-3xl px-5 pt-10">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Pedido {info.code}</p>
      <h1 className="mt-2 font-display text-4xl text-fg">
        {info.status === "paid"
          ? "Tus fotos están listas"
          : info.status === "cancelled"
            ? "Pedido cancelado"
            : isNew
              ? "¡Gracias por tu pedido!"
              : "Esperando el pago"}
      </h1>

      {info.status === "pending_payment" && info.paymentMethod === "mercadopago" ? (
        <div className="mt-6 space-y-4 rounded-ui border border-accent/40 bg-surface p-5">
          <p className="text-fg-muted">
            Total:{" "}
            <strong className="text-fg">{formatMoney(info.totalCents, info.currency)}</strong>
          </p>
          {returnedFromMp && polls < 12 ? (
            <p className="text-sm text-fg-muted" role="status">
              Estamos esperando la confirmación de Mercado Pago… esta página se actualiza sola.
            </p>
          ) : (
            <p className="text-sm text-fg-dim">Todavía no recibimos la aprobación del pago.</p>
          )}
          <button
            type="button"
            disabled={paying}
            onClick={() => void payWithMercadoPago()}
            className="rounded-ui bg-accent px-5 py-3 font-medium text-on-accent hover:bg-accent-soft disabled:opacity-50"
          >
            {paying ? "Abriendo Mercado Pago…" : "Pagar con Mercado Pago"}
          </button>
          {payError ? (
            <p role="alert" className="text-sm text-danger">
              {payError}
            </p>
          ) : null}
          <p className="text-xs text-fg-dim">
            Si ya pagaste, no hace falta pagar de nuevo: apenas se apruebe te llega un email con las
            fotos.
          </p>
        </div>
      ) : null}

      {info.status === "pending_payment" && info.paymentMethod !== "mercadopago" ? (
        <div className="mt-6 space-y-4 rounded-ui border border-accent/40 bg-surface p-5">
          <p className="text-fg-muted">
            Total a pagar:{" "}
            <strong className="text-fg">{formatMoney(info.totalCents, info.currency)}</strong>
          </p>
          <div>
            <p className="mb-1 font-mono text-xs uppercase tracking-wider text-fg-dim">
              Cómo pagar
            </p>
            <p className="whitespace-pre-line text-fg">
              {info.paymentInstructions || "El estudio te va a contactar con los datos de pago."}
            </p>
          </div>
          <p className="text-sm text-fg-dim">
            Te mandamos esta información por email. Cuando el estudio confirme el pago, vas a
            recibir otro email y en esta misma página aparecerán tus descargas.
          </p>
        </div>
      ) : null}

      {info.status === "paid" ? (
        <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {downloads.map((download) => (
            <li
              key={download.photoId}
              className="overflow-hidden rounded-ui border border-line bg-surface"
            >
              <img
                src={download.thumbUrl}
                alt={download.title}
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
              <a
                href={shopApi.downloadUrl(info.id, download.photoId, token)}
                className="block px-3 py-2 text-center font-mono text-xs uppercase tracking-wider text-accent hover:bg-raised"
              >
                Descargar
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="mt-8 divide-y divide-line rounded-ui border border-line text-sm">
        {items.map((item) => (
          <li
            key={`${item.kind}-${item.title}-${item.priceCents}`}
            className="flex justify-between p-3"
          >
            <span>{item.kind === "album" ? `Galería completa: ${item.title}` : item.title}</span>
            <span>{formatMoney(item.priceCents, info.currency)}</span>
          </li>
        ))}
        {info.discountCents ? (
          <li className="flex justify-between p-3 text-ok">
            <span>Cupón {info.couponCode}</span>
            <span>−{formatMoney(info.discountCents, info.currency)}</span>
          </li>
        ) : null}
        <li className="flex justify-between p-3 font-medium">
          <span>Total</span>
          <span>{formatMoney(info.totalCents, info.currency)}</span>
        </li>
      </ul>
      <p className="mt-4 text-xs text-fg-dim">
        Guardá el enlace de esta página: es tu acceso a las fotos.
      </p>
    </main>
  );
}

function StorefrontRoutes() {
  const storefront = useLoad(() => shopApi.storefront(), []);

  useEffect(() => {
    if (storefront.data) document.title = storefront.data.content.displayName;
  }, [storefront.data]);

  useLayoutEffect(() => {
    if (storefront.data) applyThemeToDocument(storefront.data.content.theme);
  }, [storefront.data]);

  if (storefront.loading) return <Loading />;
  if (storefront.error || !storefront.data) {
    // Order links must keep working even if the storefront is hidden later.
    if (window.location.pathname.startsWith("/pedido/")) {
      return (
        <Routes>
          <Route path="/pedido/:orderId" element={<OrderPage />} />
        </Routes>
      );
    }
    return <Notice title="Próximamente">Este estudio todavía está preparando su vitrina.</Notice>;
  }

  const data = storefront.data;
  return (
    <Shell data={data}>
      <Routes>
        <Route path="/" element={<HomePage data={data} />} />
        <Route
          path="/galeria/:albumId"
          element={<AlbumView purchasesEnabled={data.store.purchasesEnabled} />}
        />
        <Route path="/carrito" element={<CartPage data={data} />} />
        <Route path="/pedido/:orderId" element={<OrderPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

export function StorefrontApp() {
  useEffect(() => trackVisit(), []);
  useLayoutEffect(() => applyCachedTheme(), []);
  return (
    <BrowserRouter>
      <CartProvider>
        <StorefrontRoutes />
      </CartProvider>
    </BrowserRouter>
  );
}
