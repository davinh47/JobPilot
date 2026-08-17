import assert from "node:assert/strict";
import test from "node:test";
import { signupResultIndicatesExistingAccount } from "./auth-signup";

test("detects Supabase's obfuscated response for an existing signup", () => {
  assert.equal(signupResultIndicatesExistingAccount({ identities: [] }), true);
  assert.equal(signupResultIndicatesExistingAccount({ identities: [{ provider: "email" }] }), false);
  assert.equal(signupResultIndicatesExistingAccount(null), false);
});
