import { defineConfig } from "vitest/config";
import { resolveTestDatabaseUrl } from "./tests/test-database";

// Separate from vite.config.ts on purpose: that one wires up the Remix
// plugin and the Shopify dev-server host/HMR settings, none of which a test
// run wants.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // One shared Postgres, and the tests wipe tables between cases.
    fileParallelism: false,
    env: {
      DATABASE_URL: resolveTestDatabaseUrl(),
      // Signs the app-proxy requests the tests send; never a real secret.
      SHOPIFY_API_SECRET: "test-app-proxy-secret",
    },
  },
});
