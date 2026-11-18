import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { storePaymentAccounts } from "../../db/schema/index.js";
import { mercadoPagoConfigured } from "./mercadopago.client.js";

export type PaymentOptions = { mercadopago: boolean; transfer: boolean };

/**
 * Mercado Pago is offered when the platform app is configured and the store
 * connected its account. Transfer is offered when the store published payment
 * instructions, or as the only way to buy when no online method exists.
 */
export async function storePaymentOptions(
  storeId: string,
  paymentInstructions: string,
): Promise<PaymentOptions> {
  let mercadopago = false;
  if (mercadoPagoConfigured()) {
    const [account] = await db
      .select({ storeId: storePaymentAccounts.storeId })
      .from(storePaymentAccounts)
      .where(eq(storePaymentAccounts.storeId, storeId))
      .limit(1);
    mercadopago = Boolean(account);
  }
  const transfer = paymentInstructions.trim().length > 0 || !mercadopago;
  return { mercadopago, transfer };
}
