import { defineConfig } from "vitest/config";
import path from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": path.resolve(root, "client", "src"),
      "@shared": path.resolve(root, "shared"),
      "@legal": path.resolve(root, "legal"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "scripts/**/*.test.ts"],
    globals: false,
    // Integration tests that need MySQL are skipped unless DATABASE_URL is set
    // (see server/__tests__/db.integration.test.ts).
    env: { NODE_ENV: "test" },
  },
});
