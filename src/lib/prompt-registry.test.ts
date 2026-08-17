import assert from "node:assert/strict";
import test from "node:test";
import { promptRegistry, promptVersion } from "./prompt-registry";

test("prompt registry exposes stable, unique version identifiers", () => {
  const versions = Object.values(promptRegistry);
  assert.equal(new Set(versions).size, versions.length);
  for (const [id, version] of Object.entries(promptRegistry)) {
    assert.match(version, /^[a-z0-9-]+-v\d+(?:-[a-z0-9-]+)?$/);
    assert.equal(promptVersion(id as keyof typeof promptRegistry), version);
  }
});
