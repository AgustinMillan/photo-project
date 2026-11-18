import { env } from "../../config/env.js";

export function routeRateLimit(max: number, timeWindow: string) {
  return env.NODE_ENV === "test" ? { max: 10_000, timeWindow: "1 minute" } : { max, timeWindow };
}
