import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicUrl, extractReadableText, isHttpUrl, isPrivateAddress, PublicWebError, readLimitedResponseText } from "./public-web";

test("accepts only credential-free HTTP and HTTPS URL syntax", () => {
  assert.equal(isHttpUrl("https://jobs.example.com/role"), true);
  assert.equal(isHttpUrl("http://127.0.0.1:3000/jobs/1"), true);
  assert.equal(isHttpUrl("file:///tmp/job.html"), false);
  assert.equal(isHttpUrl("https://user:secret@example.com/job"), false);
});

test("rejects loopback and private addresses before public page fetching", async () => {
  await assert.rejects(assertPublicUrl("http://127.0.0.1/private"), (error) => error instanceof PublicWebError && error.code === "PRIVATE_ADDRESS");
  await assert.rejects(
    assertPublicUrl("http://example.com:3000/private"),
    /Non-standard ports/,
  );
  await assert.rejects(assertPublicUrl("http://localhost/private"), /Local addresses/);
  await assert.rejects(assertPublicUrl("http://10.0.0.1/private"), /Private network/);
  await assert.rejects(assertPublicUrl("http://100.64.0.1/private"), /Private network/);
  await assert.rejects(assertPublicUrl("http://[::ffff:127.0.0.1]/private"), /Private network/);
  assert.equal(isPrivateAddress("203.0.113.5"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
});

test("stops reading chunked responses when they exceed the page limit", async () => {
  const response = new Response("A".repeat(32));
  await assert.rejects(readLimitedResponseText(response, 16), /too large/);
  assert.equal(await readLimitedResponseText(new Response("small"), 16), "small");
});

test("extracts readable job text without a browser DOM runtime", () => {
  const paragraphs = Array.from({ length: 4 }, (_, index) => `<p>Responsibility ${index + 1}: build reliable services, document requirements, and collaborate with the product team.</p>`).join("");
  const result = extractReadableText(`<html><head><title>Platform Engineer</title><meta property="og:site_name" content="Example Careers"></head><body><nav>Navigation</nav><main>${paragraphs}</main><footer>Footer</footer></body></html>`, "https://jobs.example.com/platform-engineer");
  assert.equal(result?.title, "Platform Engineer");
  assert.equal(result?.siteName, "Example Careers");
  assert.match(result?.text ?? "", /Responsibility 4/);
  assert.doesNotMatch(result?.text ?? "", /Navigation|Footer/);
});
