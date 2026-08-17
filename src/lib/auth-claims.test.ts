import assert from "node:assert/strict";
import test from "node:test";
import { authIdentityFromClaims, authIdentityFromVerifiedHeader, serializeAuthIdentity } from "./auth-claims";

test("extracts a normalized identity from verified Supabase claims", () => {
  assert.deepEqual(authIdentityFromClaims({
    sub: " 7feab120-920b-47f0-85fd-40e778b9059f ",
    email: " candidate@example.com ",
    user_metadata: { full_name: " Ada Candidate " },
  }), {
    id: "7feab120-920b-47f0-85fd-40e778b9059f",
    email: "candidate@example.com",
    displayName: "Ada Candidate",
  });
});

test("falls back to metadata name and rejects claims without a subject", () => {
  assert.equal(authIdentityFromClaims({ email: "candidate@example.com" }), undefined);
  assert.deepEqual(authIdentityFromClaims({
    sub: "user-id",
    user_metadata: { name: "Ada" },
  }), {
    id: "user-id",
    email: null,
    displayName: "Ada",
  });
});

test("does not trust malformed claim values", () => {
  assert.equal(authIdentityFromClaims(null), undefined);
  assert.equal(authIdentityFromClaims({ sub: [] }), undefined);
  assert.deepEqual(authIdentityFromClaims({
    sub: "user-id",
    email: { address: "candidate@example.com" },
    user_metadata: "not-an-object",
  }), {
    id: "user-id",
    email: null,
    displayName: null,
  });
});

test("round-trips only normalized identity fields through the verified request header", () => {
  const identity = {
    id: "7feab120-920b-47f0-85fd-40e778b9059f",
    email: "candidate@example.com",
    displayName: "候选人 Ada",
  };
  assert.deepEqual(authIdentityFromVerifiedHeader(serializeAuthIdentity(identity)), identity);
  assert.equal(authIdentityFromVerifiedHeader("%E0%A4%A"), undefined);
  assert.equal(authIdentityFromVerifiedHeader(encodeURIComponent(JSON.stringify({ email: "candidate@example.com" }))), undefined);
});
