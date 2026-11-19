import { env } from "../../config/env.js";
import { sendEmail } from "../../shared/email/email.service.js";

export { clearTestEmailOutbox, testEmailOutbox } from "../../shared/email/email.service.js";

function buildLink(path: string, token: string): string {
  const url = new URL(path, env.APP_URL);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = buildLink("/verify-email", token);

  await sendEmail({
    to,
    subject: "Verificá tu email",
    text: [
      "Gracias por registrarte en Galeriza.",
      "",
      "Para verificar tu email, abrí este enlace:",
      link,
      "",
      "Si no creaste una cuenta, ignorá este mensaje.",
    ].join("\n"),
    html: [
      "<p>Gracias por registrarte en Galeriza.</p>",
      `<p><a href="${link}">Verificar mi email</a></p>`,
      "<p>Si no creaste una cuenta, ignorá este mensaje.</p>",
    ].join(""),
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = buildLink("/reset-password", token);

  await sendEmail({
    to,
    subject: "Restablecé tu contraseña",
    text: [
      "Recibimos una solicitud para restablecer tu contraseña.",
      "",
      "Para elegir una nueva contraseña, abrí este enlace:",
      link,
      "",
      "Si no solicitaste el cambio, ignorá este mensaje. El enlace expira pronto.",
    ].join("\n"),
    html: [
      "<p>Recibimos una solicitud para restablecer tu contraseña.</p>",
      `<p><a href="${link}">Elegir una nueva contraseña</a></p>`,
      "<p>Si no solicitaste el cambio, ignorá este mensaje. El enlace expira pronto.</p>",
    ].join(""),
  });
}
