import assert from "node:assert/strict";
import test from "node:test";
import { safeInternalPath } from "./safe-redirect";

test("allows same-origin relative application paths", () => {
  assert.equal(safeInternalPath("/jobs/123?tab=resume#editor"), "/jobs/123?tab=resume#editor");
});

test("rejects protocol-relative, absolute, backslash, and malformed redirects", () => {
  for (const value of ["//evil.example", "https://evil.example", "/\\evil.example", "\\\\evil.example", "%2f%2fevil.example"]) {
    assert.equal(safeInternalPath(value), "/matches");
  }
});

test("uses the caller fallback for absent or unsafe values", () => {
  assert.equal(safeInternalPath(undefined, "/"), "/");
  assert.equal(safeInternalPath("//evil.example", "/login"), "/login");
});
