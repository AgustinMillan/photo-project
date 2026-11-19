type ContactInfo = { displayName: string; phone: string; contactEmail: string; instagram: string };

/**
 * Where a visitor's "Consultar" button goes, in order of preference:
 * WhatsApp with a prefilled message, email, then Instagram. Null if none.
 */
export function serviceContactUrl(contact: ContactInfo, serviceTitle: string): string | null {
  const text = `Hola ${contact.displayName}, quiero consultar por: ${serviceTitle}`;
  const phone = contact.phone.replace(/\D/g, "");
  if (phone.length >= 8) return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  if (contact.contactEmail) {
    return `mailto:${contact.contactEmail}?subject=${encodeURIComponent(`Consulta: ${serviceTitle}`)}&body=${encodeURIComponent(text)}`;
  }
  if (contact.instagram) return `https://instagram.com/${contact.instagram.replace(/^@/, "")}`;
  return null;
}
