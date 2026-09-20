import { loadEnv } from "vite";

/**
 * The database the test suite is allowed to write to — and to wipe.
 *
 * The suite deletes rows, so it refuses to run against anything that is not
 * a local database named *_test. The project's .env carries a production
 * connection string in a comment and Render's real DATABASE_URL lives
 * outside the repo; neither may ever be reachable from here, whatever
 * happens to be exported in the shell.
 *
 * TEST_DATABASE_URL wins if set. Otherwise it is derived from the dev
 * DATABASE_URL in .env by swapping the database name for keepreviews_test,
 * so `npm test` works against the same local Docker Postgres as `npm run
 * dev` without touching the dev data.
 */
export function resolveTestDatabaseUrl(): string {
  const env = { ...loadEnv("test", process.cwd(), ""), ...process.env };

  let url = env.TEST_DATABASE_URL;
  if (!url) {
    if (!env.DATABASE_URL) {
      throw new Error(
        "Set TEST_DATABASE_URL, or DATABASE_URL in .env pointing at the local dev Postgres.",
      );
    }
    const derived = new URL(env.DATABASE_URL);
    derived.pathname = "/keepreviews_test";
    url = derived.toString();
  }

  const parsed = new URL(url);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  const databaseName = parsed.pathname.replace(/^\//, "");

  if (!isLocal || !databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against ${parsed.hostname}/${databaseName}: ` +
        "the test database must be on localhost and its name must end in _test.",
    );
  }

  return url;
}
