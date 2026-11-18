import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../../shared/errors/app-error.js";
import { assertTrustedOrigin } from "../../shared/http/origin.js";
import { authenticate } from "../auth/auth.guard.js";
import { requireActiveUser } from "../auth/auth.service.js";
import {
  AdminBillingError,
  activatePlan,
  endPilot,
  extendSubscription,
  startPilot,
  verifyUserEmail,
} from "../billing/billing.admin.js";
import {
  assertPlatformAdmin,
  getOverview,
  isPlatformAdmin,
  listAccounts,
  recentOrders,
} from "./admin.service.js";

const overviewQuerySchema = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) });

const email = z.string().trim().toLowerCase().email();
const note = z.string().trim().max(200).optional();

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("activate"),
    email,
    planCode: z.enum(["base", "intermediate", "business"]),
    months: z.number().int().min(1).max(24),
    note,
  }),
  z.object({ action: z.literal("extend"), email, days: z.number().int().min(1).max(365), note }),
  z.object({ action: z.literal("pilot_start"), email, note }),
  z.object({
    action: z.literal("pilot_end"),
    email,
    trialDays: z.number().int().min(0).max(365).optional(),
    note,
  }),
  z.object({ action: z.literal("verify_email"), email }),
]);

async function adminUser(request: FastifyRequest) {
  const user = await requireActiveUser(request.user.sub);
  assertPlatformAdmin(user);
  return user;
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/admin/me", { preHandler: authenticate }, async (request) => {
    const user = await requireActiveUser(request.user.sub);
    return { admin: isPlatformAdmin(user) };
  });

  app.get("/admin/overview", { preHandler: authenticate }, async (request) => {
    await adminUser(request);
    const { days } = overviewQuerySchema.parse(request.query);
    return { ...(await getOverview(days)), recentOrders: await recentOrders(15) };
  });

  app.get("/admin/accounts", { preHandler: authenticate }, async (request) => {
    await adminUser(request);
    return { accounts: await listAccounts() };
  });

  app.post("/admin/actions", { preHandler: authenticate }, async (request) => {
    assertTrustedOrigin(request);
    const user = await adminUser(request);
    const input = actionSchema.parse(request.body);
    const tag = `[panel ${user.email}]`;
    try {
      switch (input.action) {
        case "activate":
          await activatePlan({
            email: input.email,
            planCode: input.planCode,
            months: input.months,
            note: `${tag} ${input.note ?? ""}`.trim(),
          });
          break;
        case "extend":
          await extendSubscription({
            email: input.email,
            days: input.days,
            note: `${tag} ${input.note ?? ""}`.trim(),
          });
          break;
        case "pilot_start":
          await startPilot({ email: input.email, note: `${tag} ${input.note ?? ""}`.trim() });
          break;
        case "pilot_end":
          await endPilot({
            email: input.email,
            trialDays: input.trialDays,
            note: `${tag} ${input.note ?? ""}`.trim(),
          });
          break;
        case "verify_email":
          await verifyUserEmail({ email: input.email });
          break;
      }
    } catch (error) {
      if (error instanceof AdminBillingError) {
        throw new AppError({ statusCode: 409, code: error.code, message: error.message });
      }
      throw error;
    }
    return { ok: true };
  });
};
