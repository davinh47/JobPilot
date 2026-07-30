import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { validateDeploymentEnvironment } from "@/lib/deployment";

validateDeploymentEnvironment();
const databaseUrl = process.env.DATABASE_URL ?? "file:./data/jobpilot.db";
const localPath = databaseUrl.startsWith("file:") && databaseUrl !== "file::memory:"
  ? resolve(databaseUrl.replace(/^file:/, ""))
  : null;

if (localPath) {
  mkdirSync(dirname(localPath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(localPath), 0o700);
}

const client = createClient({
  url: localPath ? `file:${localPath}` : databaseUrl,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
export { client };
