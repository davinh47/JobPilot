import assert from "node:assert/strict";
import test from "node:test";
import { validateDeploymentEnvironment } from "./deployment";

test("local deployments do not require cloud credentials", () => {
  assert.doesNotThrow(() => validateDeploymentEnvironment({ JOBPILOT_DEPLOYMENT: "local" }));
});

test("hosted deployments fail closed when cloud mode is missing", () => {
  assert.throws(
    () => validateDeploymentEnvironment({ VERCEL: "1" }),
    /JOBPILOT_DEPLOYMENT=cloud/,
  );
  assert.throws(
    () => validateDeploymentEnvironment({ VERCEL_ENV: "preview", JOBPILOT_DEPLOYMENT: "local" }),
    /JOBPILOT_DEPLOYMENT=cloud/,
  );
});

test("cloud deployments fail fast for incomplete or weak configuration", () => {
  assert.throws(() => validateDeploymentEnvironment({ JOBPILOT_DEPLOYMENT: "cloud" }), /DATABASE_URL/);
  assert.throws(() => validateDeploymentEnvironment({
    JOBPILOT_DEPLOYMENT: "cloud",
    DATABASE_URL: "file:./data.db",
    DATABASE_AUTH_TOKEN: "token",
    NEXT_PUBLIC_SITE_URL: "https://example.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    JOBPILOT_SECRETS_KEY: Buffer.alloc(32).toString("base64"),
    CRON_SECRET: "a-secure-cron-secret-value",
  }), /hosted libSQL/);
});
