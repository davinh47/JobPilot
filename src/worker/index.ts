import { client } from "@/db";
import { runWorkerOnce, scheduleDueJobs } from "./service";

const once = process.argv.includes("--once");
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  do {
    await scheduleDueJobs();
    const result = await runWorkerOnce();
    if (result) console.log(`[JobPilot worker] ${result.id}: ${result.status}`);
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, result ? 500 : 5_000));
  } while (!stopping);
  client.close();
}

main().catch((error) => {
  console.error(error);
  client.close();
  process.exitCode = 1;
});
