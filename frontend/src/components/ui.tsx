import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Spinner({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-8 text-fg-dim" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  loading?: boolean;
};

export function Button({
  variant = "primary",
  loading,
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) {
  const styles = {
    primary: "bg-accent text-void hover:bg-accent-soft font-medium",
    ghost: "border border-line text-fg-muted hover:border-accent hover:text-fg",
    danger: "border border-danger/50 text-danger hover:bg-danger/10",
  }[variant];

  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-ui px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {loading ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  );
}

export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "ok" | "info";
  children: ReactNode;
}) {
  const styles = {
    error: "border-danger/40 text-danger",
    ok: "border-ok/40 text-ok",
    info: "border-accent/40 text-accent-soft",
  }[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-ui border bg-raised px-4 py-3 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | null;
  hint?: string;
};

export function Field({ label, error, hint, id, className = "", ...props }: FieldProps) {
  const inputId = id ?? `f-${label.toLowerCase().replace(/\W+/g, "-")}`;

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block font-mono text-xs uppercase tracking-wider text-fg-dim">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${inputId}-msg` : undefined}
        {...props}
        className={`w-full border-0 border-b bg-raised px-3 py-2 text-fg placeholder:text-fg-dim/60 focus:border-accent focus:outline-none ${error ? "border-danger" : "border-line"} ${className}`}
      />
      {error || hint ? (
        <p id={`${inputId}-msg`} className={`text-xs ${error ? "text-danger" : "text-fg-dim"}`}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  children,
  id,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const selectId = id ?? `s-${label.toLowerCase().replace(/\W+/g, "-")}`;

  return (
    <div className="space-y-1">
      <label htmlFor={selectId} className="block font-mono text-xs uppercase tracking-wider text-fg-dim">
        {label}
      </label>
      <select
        id={selectId}
        {...props}
        className="w-full border-0 border-b border-line bg-raised px-3 py-2 text-fg focus:border-accent focus:outline-none"
      >
        {children}
      </select>
    </div>
  );
}

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-ui border border-line bg-surface p-5">
      {title || action ? (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="font-display text-lg text-fg">{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger";
  children: ReactNode;
}) {
  const styles = {
    neutral: "border-line text-fg-muted",
    ok: "border-ok/40 text-ok",
    warn: "border-accent/40 text-accent-soft",
    danger: "border-danger/40 text-danger",
  }[tone];

  return (
    <span className={`inline-block rounded-ui border px-2 py-0.5 font-mono text-xs ${styles}`}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-3xl text-fg">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-fg-dim">{subtitle}</p> : null}
    </header>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-ui border border-line bg-surface p-4">
      <p className="font-mono text-xs uppercase tracking-wider text-fg-dim">{label}</p>
      <p className="mt-2 font-display text-2xl text-fg">{value}</p>
      {hint ? <p className="mt-1 text-xs text-fg-dim">{hint}</p> : null}
    </div>
  );
}
