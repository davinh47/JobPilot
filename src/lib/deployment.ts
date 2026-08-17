export const isCloudDeployment = process.env.JOBPILOT_DEPLOYMENT === "cloud";

const cloudRequiredVariables = [
  "DATABASE_URL",
  "DATABASE_AUTH_TOKEN",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JOBPILOT_SECRETS_KEY",
  "CRON_SECRET",
] as const;

export function validateDeploymentEnvironment(environment: Record<string, string | undefined> = process.env) {
  const hosted = environment.VERCEL === "1" || Boolean(environment.VERCEL_ENV);
  if (hosted && environment.JOBPILOT_DEPLOYMENT !== "cloud") {
    throw new Error("Hosted JobPilot deployments must set JOBPILOT_DEPLOYMENT=cloud so authentication and tenant isolation cannot be bypassed.");
  }
  if (environment.JOBPILOT_DEPLOYMENT !== "cloud") return;
  const missing = cloudRequiredVariables.filter((name) => !environment[name]?.trim());
  if (missing.length) throw new Error(`Cloud deployment is missing required environment variables: ${missing.join(", ")}.`);
  if (!environment.DATABASE_URL?.startsWith("libsql://") && !environment.DATABASE_URL?.startsWith("https://")) {
    throw new Error("Cloud DATABASE_URL must use a hosted libSQL endpoint.");
  }
  const secretsKey = Buffer.from(environment.JOBPILOT_SECRETS_KEY ?? "", "base64");
  if (secretsKey.length !== 32) throw new Error("JOBPILOT_SECRETS_KEY must be a base64-encoded 32-byte key.");
  if ((environment.CRON_SECRET?.length ?? 0) < 24) throw new Error("CRON_SECRET must contain at least 24 characters.");
}

export function requireCloudEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in cloud deployment mode.`);
  return value;
}
