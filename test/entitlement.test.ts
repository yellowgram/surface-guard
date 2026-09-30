import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EnvEntitlementStore,
  FileEntitlementStore,
  UnionEntitlementStore,
  applyBillingEntitlement,
  evaluateEntitlement,
} from "../src/billing/entitlement.js";

test("allow path: entitled org continues", async () => {
  const store = new EnvEntitlementStore(new Set(["acme"]));
  const d = await evaluateEntitlement(store, "Acme");
  assert.equal(d.outcome, "continue");
});

test("deny: org not entitled — clear message", async () => {
  const store = new EnvEntitlementStore(new Set(["other"]));
  const d = await evaluateEntitlement(store, "acme");
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") {
    assert.equal(d.code, "org_not_entitled");
    assert.match(d.summary, /surface-guard/i);
  }
});

test("deny: store unavailable — fail closed, no silent pass", async () => {
  const store = new EnvEntitlementStore(new Set(), { failIfEmpty: true });
  const d = await evaluateEntitlement(store, "acme");
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") {
    assert.equal(d.code, "entitlement_store_unavailable");
  }
});

test("deny: store throws — fail closed", async () => {
  const store = {
    async isOrgEntitled() {
      throw new Error("db down");
    },
  };
  const d = await evaluateEntitlement(store, "acme");
  assert.equal(d.outcome, "deny");
  if (d.outcome === "deny") {
    assert.equal(d.code, "entitlement_store_unavailable");
    assert.match(d.summary, /db down/);
  }
});

test("billing hook: applyBillingEntitlement adds org", () => {
  const set = new Set<string>();
  const r = applyBillingEntitlement(set, {
    orgLogin: "Acme",
    plan: "monthly",
    providerEventId: "evt_1",
  });
  assert.equal(r.added, true);
  assert.ok(set.has("acme"));
});

test("file store: grant flips allow; revoke flips deny; dedupe by event id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-ent-"));
  const path = join(dir, "entitlements.json");
  try {
    const store = new FileEntitlementStore(path);
    assert.equal((await store.isOrgEntitled("acme")).status, "not_entitled");

    const g1 = await store.grant({
      orgLogin: "Acme",
      plan: "monthly",
      providerEventId: "evt_grant_1",
    });
    assert.equal(g1.added, true);
    assert.equal(g1.duplicate, false);
    assert.equal((await store.isOrgEntitled("acme")).status, "entitled");

    const gDup = await store.grant({
      orgLogin: "Acme",
      plan: "monthly",
      providerEventId: "evt_grant_1",
    });
    assert.equal(gDup.duplicate, true);
    assert.equal(gDup.added, false);

    // Restart simulation: new store instance, same file
    const store2 = new FileEntitlementStore(path);
    assert.equal((await store2.isOrgEntitled("acme")).status, "entitled");

    const r1 = await store2.revoke({
      orgLogin: "acme",
      providerEventId: "evt_revoke_1",
      reason: "order.refunded",
    });
    assert.equal(r1.removed, true);
    assert.equal((await store2.isOrgEntitled("acme")).status, "not_entitled");

    const rDup = await store2.revoke({
      orgLogin: "acme",
      providerEventId: "evt_revoke_1",
      reason: "order.refunded",
    });
    assert.equal(rDup.duplicate, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("union store: env seed still entitles when durable empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-union-"));
  const path = join(dir, "entitlements.json");
  try {
    const durable = new FileEntitlementStore(path);
    const union = new UnionEntitlementStore(new Set(["seeded-org"]), durable);
    assert.equal((await union.isOrgEntitled("seeded-org")).status, "entitled");
    assert.equal((await union.isOrgEntitled("other")).status, "not_entitled");

    await union.grant({
      orgLogin: "paid-org",
      plan: "yearly",
      providerEventId: "evt_y",
    });
    assert.equal((await union.isOrgEntitled("paid-org")).status, "entitled");

    // Env seed is not revoked by durable revoke
    await union.revoke({
      orgLogin: "seeded-org",
      providerEventId: "evt_try_revoke_seed",
      reason: "test",
    });
    assert.equal((await union.isOrgEntitled("seeded-org")).status, "entitled");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
