import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitHubApp } from "../src/github/octokit.js";

test("octokit app: rejects non-numeric app id", () => {
  assert.throws(
    () =>
      createGitHubApp({
        appId: "not-a-number",
        privateKeyPem: "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----",
      }),
    /positive number/,
  );
});

test("octokit app: rejects non-PEM private key", () => {
  assert.throws(
    () => createGitHubApp({ appId: "123", privateKeyPem: "not-a-pem" }),
    /PEM/,
  );
});
