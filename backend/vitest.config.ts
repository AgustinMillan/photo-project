import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["test/integration/**", "**/node_modules/**", "**/dist/**"],
    setupFiles: ["./test/setup.ts"],
    restoreMocks: true,
  },
});
