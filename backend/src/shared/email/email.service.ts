import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

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

  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    ...message,
  });
}
