import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { db } from "../../db/client.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/live", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  app.get("/ready", async (request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return {
        status: "ready",
        checks: { database: "ok" },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      request.log.error({ err: error }, "Database readiness check failed");
      return reply.status(503).send({
        status: "not_ready",
        checks: { database: "error" },
        timestamp: new Date().toISOString(),
      });
    }
  });
};
