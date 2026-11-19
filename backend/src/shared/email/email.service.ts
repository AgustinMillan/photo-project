import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Display name for the sender, e.g. "Estudio X vía Galeriza". Defaults to SMTP_FROM's. */
  fromName?: string;
  /** Where replies go (e.g. the photographer), instead of the platform mailbox. */
  replyTo?: string;
  /** Title in the email header. Defaults to "Galeriza". */
  brand?: string;
  /** Footer line. */
  footer?: string;
};

const ACCENT = "#0284c7";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="border-radius:6px;background:${ACCENT}"><a style="display:inline-block;padding:12px 22px;font-weight:600;font-size:15px;color:#ffffff;text-decoration:none;border-radius:6px" href="${href}">${label}</a></td></tr></table>`;
}

/**
 * Wraps a message body in the branded layout. A paragraph that contains only a
 * link becomes a button; other links get the brand color.
 */
export function renderEmailHtml(body: string, brand = "Galeriza", footer?: string): string {
  const content = body
    .replace(/<p>\s*<a href="([^"]+)">([^<]+)<\/a>\s*<\/p>/g, (_m, href: string, label: string) =>
      button(href, label),
    )
    .replace(/<a href="/g, `<a style="color:${ACCENT}" href="`)
    .replace(/<p>/g, '<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f2937">');
  const footerText =
    footer ?? "Galeriza · Tu tienda de fotos con cobro y entrega automática · galeriza.com.ar";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(brand)}</title></head><body style="margin:0;padding:0;background:#f3f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f9"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px"><tr><td style="padding:0 4px 16px;font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#0b1220">${escapeHtml(brand)}</td></tr><tr><td style="background:#ffffff;border-radius:10px;padding:28px 28px 14px;border:1px solid #e5e7eb">${content}</td></tr><tr><td style="padding:16px 4px;font-size:12px;line-height:1.5;color:#6b7280">${escapeHtml(footerText)}</td></tr></table></td></tr></table></body></html>`;
}

/** "Name <addr>" built from SMTP_FROM's address with another display name. */
function fromWithName(name: string | undefined): string {
  if (!name) return env.SMTP_FROM;
  const address = env.SMTP_FROM.match(/<([^>]+)>/)?.[1] ?? env.SMTP_FROM.trim();
  return `"${name.replace(/["\\]/g, "")}" <${address}>`;
}

export const testEmailOutbox: EmailMessage[] = [];

export function clearTestEmailOutbox(): void {
  testEmailOutbox.length = 0;
}

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (!transporter) {
    const authenticated = Boolean(env.SMTP_USER);
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      // Local catchers (Mailpit) have no TLS; real providers require it.
      ignoreTLS: !authenticated && !env.SMTP_SECURE,
      requireTLS: authenticated && !env.SMTP_SECURE,
      auth: authenticated
        ? { user: env.SMTP_USER ?? "", pass: env.SMTP_PASSWORD ?? "" }
        : undefined,
    });
  }

  return transporter;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (env.NODE_ENV === "test") {
    testEmailOutbox.push(message);
    return;
  }

  if (env.EMAIL_TRANSPORT === "log") {
    logger.warn(
      { emailTo: message.to, emailSubject: message.subject, emailText: message.text },
      "EMAIL_TRANSPORT=log: email not sent, logged instead",
    );
    return;
  }

  const { fromName, replyTo, brand, footer, ...content } = message;
  await getTransporter().sendMail({
    from: fromWithName(fromName),
    ...(replyTo ? { replyTo } : {}),
    ...content,
    html: renderEmailHtml(content.html, brand, footer),
  });
}
