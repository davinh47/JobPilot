import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthCallbackUrl, resolveAuthOrigin } from "./auth-redirect";

test("cloud auth redirects prefer the configured canonical origin", () => {
  assert.equal(
    resolveAuthOrigin("https://legacy-preview.vercel.app", "https://try-jobpilot.vercel.app/"),
    "https://try-jobpilot.vercel.app",
  );
  assert.equal(
    buildAuthCallbackUrl(
      "https://legacy-preview.vercel.app",
      "/matches",
      "https://try-jobpilot.vercel.app/",
    ),
    "https://try-jobpilot.vercel.app/auth/callback?next=%2Fmatches",
  );
});

test("local auth redirects fall back to the current browser origin", () => {
  assert.equal(resolveAuthOrigin("http://127.0.0.1:3000", ""), "http://127.0.0.1:3000");
  assert.equal(
    buildAuthCallbackUrl("http://127.0.0.1:3000", "/reset-password", ""),
    "http://127.0.0.1:3000/auth/callback?next=%2Freset-password",
  );
});

test("invalid configured origins do not replace a valid browser origin", () => {
  assert.equal(resolveAuthOrigin("https://example.com", "not a URL"), "https://example.com");
});
