import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const databaseUrl = process.env.DATABASE_URL ?? "file:./data/jobpilot.db";
const localPath = databaseUrl.startsWith("file:") ? resolve(databaseUrl.replace(/^file:/, "")) : null;
if (localPath) {
  mkdirSync(dirname(localPath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(localPath), 0o700);
}

async function main() {
  const client = createClient({
    url: localPath ? `file:${localPath}` : databaseUrl,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: resolve("drizzle") });
  client.close();
  if (localPath) chmodSync(localPath, 0o600);

  console.log(`Database migrated: ${localPath ?? databaseUrl.replace(/\/\/.*@/, "//***@")}`);
}

void main();
