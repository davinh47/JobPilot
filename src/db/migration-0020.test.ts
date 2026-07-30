import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

test("tenant migration backfills legacy owner and queue rows", async () => {
  const folder = await mkdtemp(resolve(tmpdir(), "jobpilot-migration-"));
  const migrations = resolve(folder, "drizzle");
  const source = resolve("drizzle");
  await mkdir(resolve(migrations, "meta"), { recursive: true });
  const sqlFiles = (await readdir(source)).filter((name) => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 19);
  await Promise.all(sqlFiles.map((name) => copyFile(resolve(source, name), resolve(migrations, name))));
  const journal = JSON.parse(await readFile(resolve(source, "meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((entry) => entry.idx <= 19);
  await writeFile(resolve(migrations, "meta/_journal.json"), JSON.stringify(journal));

  const client = createClient({ url: "file::memory:" });
  try {
    await migrate(drizzle(client), { migrationsFolder: migrations });
    const now = Date.now();
    await client.execute({ sql: "INSERT INTO users (id, display_name, locale, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", args: ["legacy-user", "Legacy", "en-US", "UTC", now, now] });
    await client.execute({
      sql: "INSERT INTO jobs (id, owner_user_id, company_name, title, workplace_type, description_text, canonical_key, listing_status, missing_check_count, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: ["legacy-job", "Legacy Co", "Engineer", "unknown", "Legacy job description", "legacy-key", "unknown", 0, now, now, now, now],
    });
    await client.execute({
      sql: "INSERT INTO background_jobs (id, job_type, status, payload_json, priority, attempts, max_attempts, run_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: ["legacy-task", "search_reindex", "queued", JSON.stringify({ userId: "legacy-user" }), 1, 0, 3, now, now, now],
    });
    const migration = await readFile(resolve(source, "0020_giant_purifiers.sql"), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await client.execute(statement);
    }
    const owner = await client.execute("SELECT owner_user_id FROM jobs WHERE id = 'legacy-job'");
    const tenant = await client.execute("SELECT user_id FROM background_jobs WHERE id = 'legacy-task'");
    assert.equal(owner.rows[0]?.owner_user_id, "legacy-user");
    assert.equal(tenant.rows[0]?.user_id, "legacy-user");
  } finally {
    client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
