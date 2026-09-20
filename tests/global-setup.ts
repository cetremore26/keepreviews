import { execSync } from "node:child_process";
import { resolveTestDatabaseUrl } from "./test-database";

/** Brings the test database to the current schema before any test runs.
 *  `prisma migrate deploy` creates the database if it does not exist yet and
 *  applies every migration in prisma/migrations — the same command
 *  production runs at start-up (`npm run setup`), so the suite exercises the
 *  real migrations, including the data ones. */
export default function setup() {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: resolveTestDatabaseUrl() },
    stdio: "inherit",
  });
}
