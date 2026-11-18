import { db } from "../../db/client.js";
import { auditLogs } from "../../db/schema/index.js";
import { logger } from "../../shared/logger.js";

export type AuditEvent = {
  action: string;
  actorUserId?: string;
  accountId?: string;
  storeId?: string;
  entityType: string;
  entityId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      accountId: event.accountId ?? null,
      storeId: event.storeId ?? null,
      actorUserId: event.actorUserId ?? null,
      actorType: "user",
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      before: event.before ?? null,
      after: event.after ?? null,
      metadata: event.metadata ?? {},
      requestId: event.requestId ?? null,
      ip: event.ip ?? null,
      userAgent: event.userAgent ? event.userAgent.slice(0, 512) : null,
    });
  } catch (error) {
    // Audit failures are logged but do not turn a successful user action into
    // a failed request. The error is still visible to operators.
    logger.error({ err: error, action: event.action }, "Failed to write audit log");
  }
}
