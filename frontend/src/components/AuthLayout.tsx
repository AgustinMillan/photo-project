import type { ReactNode } from "react";

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <p className="mb-8 text-center font-mono text-xs uppercase tracking-[0.3em] text-accent">
          Photo Platform
        </p>
        <div className="rounded-ui border border-line bg-surface p-8">
          <h1 className="font-display text-3xl text-fg">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-fg-dim">{subtitle}</p> : null}
          <div className="mt-6 space-y-5">{children}</div>
        </div>
        {footer ? <div className="mt-5 text-center text-sm text-fg-dim">{footer}</div> : null}
      </div>
    </main>
  );
}
