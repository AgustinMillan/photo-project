import { createApiClient } from "./api.ts";

export const api = createApiClient({ baseUrl: "/api/v1" });
