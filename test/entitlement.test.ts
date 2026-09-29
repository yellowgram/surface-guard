import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EnvEntitlementStore,
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
