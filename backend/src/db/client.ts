import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

export const pgClient = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {
    // PostgreSQL notices are intentionally not printed; structured logs cover
    // application-level events and migration output is explicit.
  },
});

export const db = drizzle(pgClient, { schema });

export async function closeDb(): Promise<void> {
  await pgClient.end({ timeout: 5 });
}
