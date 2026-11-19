import { parseArgs } from "node:util";
import { closeDb } from "../db/client.js";
import {
  AdminBillingError,
  type AdminSubscriptionSummary,
  activatePlan,
  endPilot,
  extendSubscription,
  listSubscriptions,
  startPilot,
  verifyUserEmail,
} from "../modules/billing/billing.admin.js";
import {
  sendTrialEndingReminders,
  syncSubscription,
} from "../modules/billing/billing.mercadopago.js";

const USAGE = `Uso: pnpm admin <comando> [opciones]

Comandos:
  list                                   Todas las cuentas con plan, estado y vencimiento
  status     <email>                     Estado de una cuenta
  activate   <email> --plan <codigo> [--months N]
                                         Registra un pago manual: plan activo N meses (por defecto 1)
  extend     <email> --days N            Suma días gratis a la prueba o al período pago
  pilot:start <email>                    Cliente piloto: todo habilitado, gratis y sin vencimiento
  pilot:end   <email> [--trial-days N]   Termina el piloto; pasa a prueba del plan base (por defecto 30 días)
  verify-email <email>                   Marca el email como verificado (mientras no haya proveedor de email)
  billing:daily                          Recordatorios de fin de prueba y sincronización con Mercado Pago (cron)

Opciones comunes:
  --note "texto"                         Nota que queda en la auditoría (ej.: "transferencia 18/11")

Planes: base, pro (Profesional), business (piloto)`;

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "-";
}

function printSummaries(rows: AdminSubscriptionSummary[]): void {
  if (rows.length === 0) {
    console.log("Sin cuentas.");
    return;
  }

  console.table(
    rows.map((row) => ({
      email: row.ownerEmail,
      cuenta: row.accountName,
      plan: row.planCode ?? "-",
      estado: row.isPilot ? "piloto" : (row.status ?? "sin suscripción"),
      vence: row.isPilot
        ? "nunca"
        : formatDate(
            row.status === "trial" ? row.trialEndsAt : (row.currentPeriodEnd ?? row.trialEndsAt),
          ),
    })),
  );
}

function intOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new AdminBillingError("INVALID_ARGUMENT", `--${name} debe ser un número entero.`);
  }

  return parsed;
}

export async function runAdminCli(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      plan: { type: "string" },
      months: { type: "string" },
      days: { type: "string" },
      "trial-days": { type: "string" },
      note: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  const [command, email] = positionals;

  if (!command || values.help) {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  const requireEmail = (): string => {
    if (!email) {
      throw new AdminBillingError("INVALID_ARGUMENT", `Falta el email para "${command}".`);
    }
    return email;
  };

  switch (command) {
    case "list":
      printSummaries(await listSubscriptions());
      return 0;
    case "status":
      printSummaries(await listSubscriptions({ email: requireEmail() }));
      return 0;
    case "activate": {
      if (!values.plan) {
        throw new AdminBillingError(
          "INVALID_ARGUMENT",
          "Falta --plan (base, intermediate, business).",
        );
      }
      await activatePlan({
        email: requireEmail(),
        planCode: values.plan,
        months: intOption(values.months, "months") ?? 1,
        note: values.note,
      });
      break;
    }
    case "extend": {
      const days = intOption(values.days, "days");
      if (days === undefined) {
        throw new AdminBillingError("INVALID_ARGUMENT", "Falta --days.");
      }
      await extendSubscription({ email: requireEmail(), days, note: values.note });
      break;
    }
    case "pilot:start":
      await startPilot({ email: requireEmail(), note: values.note });
      break;
    case "pilot:end":
      await endPilot({
        email: requireEmail(),
        trialDays: intOption(values["trial-days"], "trial-days"),
        note: values.note,
      });
      break;
    case "billing:daily": {
      const reminders = await sendTrialEndingReminders();
      const synced = await syncAllAutoPayments();
      console.log(`Recordatorios enviados: ${reminders}. Suscripciones sincronizadas: ${synced}.`);
      return 0;
    }
    case "verify-email":
      await verifyUserEmail({ email: requireEmail() });
      console.log("Email verificado.");
      return 0;
    default:
      console.error(`Comando desconocido: ${command}\n\n${USAGE}`);
      return 1;
  }

  console.log("Listo.");
  printSummaries(await listSubscriptions({ email: requireEmail() }));
  return 0;
}

/** Safety net in case a webhook was lost: re-read every automatic payment. */
async function syncAllAutoPayments(): Promise<number> {
  const { db } = await import("../db/client.js");
  const { subscriptions } = await import("../db/schema/index.js");
  const { and, isNotNull, isNull } = await import("drizzle-orm");
  const rows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(isNull(subscriptions.endedAt), isNotNull(subscriptions.mpPreapprovalId)));
  for (const row of rows) {
    try {
      await syncSubscription(row.id);
    } catch (error) {
      console.error(`No se pudo sincronizar ${row.id}:`, error);
    }
  }
  return rows.length;
}

const isEntrypoint = process.argv[1]?.replace(/\.ts$/, ".js").endsWith("admin/cli.js");

if (isEntrypoint) {
  try {
    process.exitCode = await runAdminCli(process.argv.slice(2));
  } catch (error) {
    if (error instanceof AdminBillingError) {
      console.error(`Error (${error.code}): ${error.message}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
