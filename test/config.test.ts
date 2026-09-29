import assert from "node:assert/strict";
import { test } from "node:test";
import { isUnconfiguredSecret, loadConfig, parseEntitledOrgs } from "../src/config.js";
import { SurfaceGuardDeny } from "../src/errors.js";

test("parseEntitledOrgs normalizes case and commas", () => {
  const s = parseEntitledOrgs(" Acme, OTHER,acme ");
  assert.ok(s.has("acme"));
  assert.ok(s.has("other"));
  assert.equal(s.size, 2);
});

test("isUnconfiguredSecret catches placeholders", () => {
  assert.equal(isUnconfiguredSecret("replace_me"), true);
  assert.equal(isUnconfiguredSecret("short"), true);
  assert.equal(isUnconfiguredSecret("a-long-random-secret!!"), false);
});

test("loadConfig refuses placeholder webhook secret", () => {
  assert.throws(
    () =>
      loadConfig({
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "pk",
        GITHUB_WEBHOOK_SECRET: "replace_with_long_random_secret",
      }),
    (err: unknown) =>
      err instanceof SurfaceGuardDeny && err.code === "webhook_secret_unconfigured",
  );
});

test("loadConfig accepts configured env", () => {
  const c = loadConfig({
    GITHUB_APP_ID: "1",
    GITHUB_APP_PRIVATE_KEY: "pk",
    GITHUB_WEBHOOK_SECRET: "a-long-random-secret!!",
    SURFACE_GUARD_ENTITLED_ORGS: "acme",
    SURFACE_GUARD_SURFACE_PATH: "tools.json",
  });
  assert.equal(c.appId, "1");
  assert.ok(c.entitledOrgs.has("acme"));
  assert.equal(c.surfacePath, "tools.json");
  assert.equal(c.lockfilePath, "surfacepin.lock.json");
});
