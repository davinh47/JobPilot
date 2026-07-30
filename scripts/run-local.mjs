import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(resolve(".env.local"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const mode = process.argv[2] === "start" ? "start" : "dev";
const forwardedArgs = process.argv.slice(3);
const hasHostname = forwardedArgs.some((arg) => arg === "--hostname" || arg === "-H" || arg.startsWith("--hostname="));
const nextArgs = [resolve("node_modules/next/dist/bin/next"), mode, ...(hasHostname ? [] : ["--hostname", "127.0.0.1"]), ...forwardedArgs];
const hasProxy = Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY);
const proxyArgs = hasProxy && process.allowedNodeEnvironmentFlags.has("--use-env-proxy") ? ["--use-env-proxy"] : [];
const childEnv = hasProxy ? { ...process.env, NO_PROXY: process.env.NO_PROXY ?? "127.0.0.1,localhost" } : process.env;
if (hasProxy && !proxyArgs.length) console.warn("[JobPilot] This Node.js version cannot apply the configured network proxy automatically.");
if (proxyArgs.length) console.log("[JobPilot] Network proxy enabled for the server and worker.");
const next = spawn(process.execPath, [...proxyArgs, ...nextArgs], { stdio: "inherit", env: childEnv });
const worker = spawn(process.execPath, [...proxyArgs, "--import", "tsx", "src/worker/index.ts"], { stdio: "inherit", env: childEnv });
const children = [next, worker];
let stopping = false;

function stop(signal = "SIGTERM", exitCode) {
  if (stopping) return;
  stopping = true;
  if (typeof exitCode === "number") process.exitCode = exitCode;
  for (const child of children) if (!child.killed) child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
for (const child of children) {
  child.on("error", (error) => {
    console.error(error);
    stop("SIGTERM", 1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) stop(signal === "SIGINT" ? "SIGINT" : "SIGTERM", code ?? 1);
  });
}
