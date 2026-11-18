import { z } from "zod";

export const createOrderSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerEmail: z.string().trim().toLowerCase().email().max(254),
  items: z
    .array(z.object({ type: z.enum(["photo", "album"]), id: z.string().uuid() }))
    .min(1)
    .max(300),
  paymentMethod: z.enum(["transfer", "mercadopago"]).default("transfer"),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const recordPaymentSchema = z.object({
  amountCents: z.number().int().positive().max(1_000_000_000),
  method: z.enum(["transfer", "cash", "other"]),
  reference: z.string().trim().max(200).default(""),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const orderParamsSchema = z.object({ orderId: z.string().uuid() });
export const storeOrderParamsSchema = z.object({
  storeId: z.string().uuid(),
  orderId: z.string().uuid(),
});
export const downloadParamsSchema = z.object({
  orderId: z.string().uuid(),
  photoId: z.string().uuid(),
});
export const tokenQuerySchema = z.object({ token: z.string().max(100).optional() });
export const listOrdersQuerySchema = z.object({
  status: z.enum(["pending_payment", "paid", "cancelled"]).optional(),
});
