import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { trackVisit } from "../lib/visit.ts";

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "";

const STEPS = [
  {
    title: "Creá tu tienda",
    text: "Elegí el nombre de tu estudio y tenés tu página propia en minutos, con tu link para compartir en Instagram y WhatsApp.",
  },
  {
    title: "Subí tus fotos y servicios",
    text: "Armá galerías, poné precio por foto o por galería completa y contá qué servicios ofrecés. Las fotos se muestran con tu marca de agua.",
  },
  {
    title: "Cobrá y entregá solo",
    text: "Tus clientes pagan con Mercado Pago y reciben las fotos en alta resolución por email, al instante. Vos no tenés que hacer nada.",
  },
];

const FEATURES = [
  {
    title: "Cobro con Mercado Pago",
    text: "Tarjeta, débito o dinero en cuenta. La plata va directo a tu cuenta, sin intermediarios.",
  },
  {
    title: "Entrega automática",
    text: "Cuando se aprueba el pago, el cliente recibe su link de descarga. Chau Drive, WeTransfer y pendrives.",
  },
  {
    title: "Fotos protegidas",
    text: "En la tienda se ven vistas previas con marca de agua. Los originales solo los descarga quien pagó.",
  },
  {
    title: "Galerías por evento",
    text: "Ideal para casamientos, egresos, carreras o actos: cada persona compra sus fotos o la galería completa.",
  },
  {
    title: "Tus servicios",
    text: "Mostrá lo que ofrecés con precio “desde” y un botón para que te consulten directo por WhatsApp.",
  },
  {
    title: "Pedidos en orden",
    text: "Mirá cada venta, quién compró y qué descargó. También podés aceptar transferencias si querés.",
  },
];

const PLANS = [
  {
    name: "Base",
    price: "$15.000",
    highlight: false,
    points: [
      "Tu tienda con link propio",
      "Galerías y fotos ilimitadas para vender",
      "Cobro con Mercado Pago y transferencia",
      "Entrega automática en alta resolución",
      "Sección de servicios con consultas por WhatsApp",
      "Sin comisión de la plataforma por venta",
    ],
  },
  {
    name: "Profesional",
    price: "$20.000",
    highlight: true,
    points: [
      "Todo lo del plan Base",
      "Visitas, ventas e ingresos por día",
      "Tus fotos y galerías más vendidas",
      "Conversión de visitas a ventas",
      "Comparación con el mes anterior",
    ],
  },
];

const FAQ = [
  {
    q: "¿Necesito saber de diseño o programación?",
    a: "No. Completás tus datos, subís fotos y publicás. La tienda ya viene diseñada para que tus fotos se luzcan.",
  },
  {
    q: "¿Cuánto me cobran por cada venta?",
    a: "La plataforma no cobra comisión por venta. Mercado Pago descuenta su comisión habitual de cada cobro, como en cualquier venta con Mercado Pago.",
  },
  {
    q: "¿Cómo funciona la prueba gratis?",
    a: "Tenés 30 días con todo habilitado (incluidas las estadísticas) y sin cargar tarjeta. Si te sirve, elegís Base o Profesional y el abono se cobra solo cada mes con Mercado Pago.",
  },
  {
    q: "¿Mis fotos están seguras?",
    a: "Los originales se guardan en privado y nunca se muestran en la tienda. Las vistas previas llevan tu marca de agua y no incluyen datos de la cámara ni ubicación.",
  },
  {
    q: "¿Puedo cobrar por transferencia?",
    a: "Sí. Podés ofrecer Mercado Pago, transferencia o ambos. Con transferencia, confirmás el pago desde tu panel y las fotos se entregan solas.",
  },
];

function MockStorefront() {
  // Decorative preview of a storefront, drawn with gradients (no real photos).
  const tiles = [
    "from-sky-900 via-slate-800 to-slate-900",
    "from-amber-900/70 via-stone-800 to-slate-900",
    "from-slate-700 via-slate-800 to-sky-950",
    "from-rose-900/60 via-slate-800 to-slate-900",
    "from-emerald-900/60 via-slate-800 to-slate-900",
    "from-indigo-900 via-slate-800 to-slate-900",
  ];
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-full max-w-md rotate-1 rounded-2xl border border-line bg-surface p-3 shadow-2xl shadow-black/50"
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="font-display text-sm text-fg">Estudio Luz</span>
        <span className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-fg-muted">
          CARRITO (2)
        </span>
      </div>
      <div className="mb-3 h-24 rounded-lg bg-gradient-to-br from-sky-800 via-slate-800 to-void p-3">
        <p className="font-display text-lg text-fg">Egresados 2026</p>
        <p className="text-[11px] text-fg-muted">48 fotos · Galería completa $20.000</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((tile, index) => (
          <div key={tile} className={`relative aspect-square rounded-md bg-gradient-to-br ${tile}`}>
            <span className="absolute bottom-1 right-1 rounded bg-void/70 px-1 font-mono text-[9px] text-fg-muted">
              ${(index + 2) * 1000}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-md bg-accent px-3 py-2 text-center text-xs font-medium text-void">
        Pagar con Mercado Pago · $5.000
      </div>
    </div>
  );
}

export function LandingPage() {
  const { user } = useAuth();

  useEffect(() => trackVisit(), []);

  useEffect(() => {
    document.title = "Galeriza · Tu tienda de fotos con cobro y entrega automática";
  }, []);

  return (
    <div className="min-h-screen bg-void text-fg">
      <header className="sticky top-0 z-20 border-b border-line/60 bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <span className="font-display text-xl">Galeriza</span>
          <nav className="flex items-center gap-3 text-sm">
            <a href="#precio" className="hidden text-fg-muted hover:text-fg sm:inline">
              Precio
            </a>
            <a href="#preguntas" className="hidden text-fg-muted hover:text-fg sm:inline">
              Preguntas
            </a>
            {user ? (
              <Link
                to="/app"
                className="rounded-ui bg-accent px-4 py-2 font-medium text-void hover:bg-accent-soft"
              >
                Ir a mi panel
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-fg-muted hover:text-fg">
                  Ingresar
                </Link>
                <Link
                  to="/register"
                  className="rounded-ui bg-accent px-4 py-2 font-medium text-void hover:bg-accent-soft"
                >
                  Probar gratis
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 md:grid-cols-[1.1fr_1fr] md:py-24">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
              Para fotógrafos
            </p>
            <h1 className="mt-4 font-display text-4xl leading-tight md:text-6xl">
              Tu tienda de fotos, con cobro y entrega automática.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-fg-muted">
              Mostrá tu trabajo, vendé fotos por unidad o por evento, cobrá con Mercado Pago y que
              tus clientes reciban sus fotos solos. Sin pelearte más con Drive, WeTransfer ni
              comprobantes de transferencia.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/register"
                className="rounded-ui bg-accent px-6 py-3 font-medium text-void hover:bg-accent-soft"
              >
                Probar gratis 30 días
              </Link>
              <a
                href="#como-funciona"
                className="rounded-ui border border-line px-6 py-3 text-fg-muted hover:border-accent"
              >
                Cómo funciona
              </a>
            </div>
            <p className="mt-4 text-sm text-fg-dim">
              Sin tarjeta. Sin comisión de la plataforma por venta.
            </p>
          </div>
          <MockStorefront />
        </section>

        <section id="como-funciona" className="border-y border-line/60 bg-surface/40">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="font-display text-3xl">Cómo funciona</h2>
            <ol className="mt-8 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-ui border border-line bg-surface p-6">
                  <span className="font-mono text-sm text-accent">0{index + 1}</span>
                  <h3 className="mt-2 font-display text-xl">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fg-muted">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl">Todo lo que necesitás para vender tus fotos</h2>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="border-l-2 border-accent/60 pl-4">
                <h3 className="font-medium text-fg">{feature.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">{feature.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="precio" className="border-y border-line/60 bg-surface/40">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="font-display text-3xl">Precios simples, sin comisión por venta</h2>
            <p className="mt-2 text-fg-muted">
              30 días gratis con todo incluido. Después elegís tu plan.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {PLANS.map((plan) => (
                <div
                  key={plan.name}
                  className={`flex flex-col rounded-2xl border bg-surface p-8 ${
                    plan.highlight ? "border-accent/60" : "border-line"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
                      Plan {plan.name}
                    </p>
                    {plan.highlight ? (
                      <span className="rounded border border-accent/50 px-2 py-0.5 font-mono text-[10px] text-accent-soft">
                        CON ESTADÍSTICAS
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 font-display text-5xl">
                    {plan.price}
                    <span className="font-sans text-base text-fg-muted"> / mes</span>
                  </p>
                  <ul className="mt-6 flex-1 space-y-2 text-sm text-fg-muted">
                    {plan.points.map((point) => (
                      <li key={point}>✓ {point}</li>
                    ))}
                  </ul>
                  <Link
                    to="/register"
                    className={`mt-8 block rounded-ui px-6 py-3 text-center font-medium ${
                      plan.highlight
                        ? "bg-accent text-void hover:bg-accent-soft"
                        : "border border-line text-fg hover:border-accent"
                    }`}
                  >
                    Empezar 30 días gratis
                  </Link>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-fg-dim">
              El abono se paga con Mercado Pago y se renueva solo cada mes. Podés cancelarlo cuando
              quieras.
            </p>
          </div>
        </section>

        <section id="preguntas" className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="font-display text-3xl">Preguntas frecuentes</h2>
          <div className="mt-8 divide-y divide-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="cursor-pointer list-none font-medium text-fg marker:hidden">
                  <span className="mr-2 inline-block text-accent transition-transform group-open:rotate-45">
                    +
                  </span>
                  {item.q}
                </summary>
                <p className="mt-2 pl-6 text-sm leading-relaxed text-fg-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-24">
          <div className="rounded-2xl border border-line bg-gradient-to-br from-surface via-raised to-void p-10 text-center">
            <h2 className="font-display text-3xl">Tu próxima sesión ya puede cobrarse sola</h2>
            <p className="mx-auto mt-3 max-w-xl text-fg-muted">
              Creá tu tienda hoy y probala gratis durante 30 días.
            </p>
            <Link
              to="/register"
              className="mt-6 inline-block rounded-ui bg-accent px-6 py-3 font-medium text-void hover:bg-accent-soft"
            >
              Probar gratis
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/60 px-5 py-8 text-center text-xs text-fg-dim">
        © {new Date().getFullYear()} Galeriza
        {SUPPORT_EMAIL ? (
          <>
            {" · "}
            <a className="hover:text-fg" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </>
        ) : null}
      </footer>
    </div>
  );
}
