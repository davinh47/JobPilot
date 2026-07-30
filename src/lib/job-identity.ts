import { createHash } from "node:crypto";

export function normalizeJobUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Job URLs must use public HTTP(S).");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|source$|ref$)/i.test(key)) url.searchParams.delete(key);
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function hashJobIdentity(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJobKey(url: string) {
  return hashJobIdentity(normalizeJobUrl(url));
}
