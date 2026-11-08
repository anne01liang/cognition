import { execSync } from "node:child_process";

/** Resets the dedicated TEST schema (never the dev schema) before integration tests. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    if (process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set");
    console.warn("[vitest] TEST_DATABASE_URL not set: DB integration tests will be skipped");
    return;
  }
  if (!/schema=test\b/.test(url)) throw new Error("TEST_DATABASE_URL must point at a schema named `test` (it gets reset)");
  execSync("npx prisma migrate reset --force --skip-seed --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes" },
  });
}
