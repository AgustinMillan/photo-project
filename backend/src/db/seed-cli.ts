import { closeDb } from "./client.js";
import { backfillTrialSubscriptions, seedDefaultPlans } from "./seed.js";

try {
  await seedDefaultPlans();
  const backfilled = await backfillTrialSubscriptions();
  console.log(`Plans seeded. Backfilled ${backfilled} trial subscription(s).`);
} catch (error) {
  console.error("Database seed failed.", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
