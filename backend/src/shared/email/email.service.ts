import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";

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
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
      ignoreTLS: true,
    });
  }

  return transporter;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (env.NODE_ENV === "test") {
    testEmailOutbox.push(message);
    return;
  }

  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    ...message,
  });
}
