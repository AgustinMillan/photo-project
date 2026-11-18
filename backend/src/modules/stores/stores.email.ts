import { env } from "../../config/env.js";
import { sendEmail } from "../../shared/email/email.service.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildInvitationLink(token: string): string {
  const url = new URL("/accept-invitation", env.APP_URL);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function sendStoreInvitationEmail(options: {
  to: string;
  storeName: string;
  inviterName: string;
  token: string;
}): Promise<void> {
  const link = buildInvitationLink(options.token);
  const storeName = escapeHtml(options.storeName);
  const inviterName = escapeHtml(options.inviterName);

  await sendEmail({
    to: options.to,
    subject: `Invitación a ${options.storeName}`,
    text: [
      `${options.inviterName} te invitó a colaborar en la tienda ${options.storeName}.`,
      "",
      "Para aceptar la invitación, abrí este enlace:",
      link,
      "",
      "Si no esperabas esta invitación, ignorá este mensaje.",
    ].join("\n"),
    html: [
      `<p><strong>${inviterName}</strong> te invitó a colaborar en la tienda <strong>${storeName}</strong>.</p>`,
      `<p><a href="${link}">Aceptar invitación</a></p>`,
      "<p>Si no esperabas esta invitación, ignorá este mensaje.</p>",
    ].join(""),
  });
}
