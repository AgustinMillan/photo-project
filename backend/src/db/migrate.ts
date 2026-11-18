import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, db } from "./client.js";
import { backfillTrialSubscriptions, seedDefaultPlans } from "./seed.js";

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedDefaultPlans();
  const backfilled = await backfillTrialSubscriptions();
  console.log(
    `Database migrations completed. Seeded plans and backfilled ${backfilled} trial subscription(s).`,
  );
} catch (error) {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
