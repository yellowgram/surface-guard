import assert from "node:assert/strict";
import { test } from "node:test";
import { postSurfaceGuardCheck } from "../src/github/checks.js";
import type { GuardOctokit } from "../src/github/octokit.js";
import type { Decision } from "../src/errors.js";

test("checks: posts completed run with decision title/summary", async () => {
  const calls: unknown[] = [];
  const octokit = {
    rest: {
      checks: {
        create: async (args: unknown) => {
          calls.push(args);
          return { data: { id: 99, html_url: "https://github.com/acme/mcp/runs/99" } };
        },
      },
    },
  } as unknown as GuardOctokit;

  const decision: Decision = {
    outcome: "deny",
    code: "lockfile_drift",
    title: "Surface Guard: surface drift",
    summary: "drift detail",
    conclusion: "failure",
  };

  const r = await postSurfaceGuardCheck(octokit, {
    owner: "acme",
    repo: "mcp",
    sha: "abc123",
    decision,
  });
  assert.equal(r.id, 99);
  assert.equal(calls.length, 1);
  const args = calls[0] as Record<string, unknown>;
  assert.equal(args.head_sha, "abc123");
  assert.equal(args.status, "completed");
  assert.equal(args.conclusion, "failure");
  assert.equal(args.name, "Surface Guard");
  const output = args.output as { title: string; summary: string };
  assert.equal(output.title, decision.title);
  assert.equal(output.summary, decision.summary);
});

test("checks: API error → throw (fail closed, no silent skip)", async () => {
  const octokit = {
    rest: {
      checks: {
        create: async () => {
          throw new Error("boom");
        },
      },
    },
  } as unknown as GuardOctokit;

  await assert.rejects(
    () =>
      postSurfaceGuardCheck(octokit, {
        owner: "acme",
        repo: "mcp",
        sha: "abc",
        decision: {
          outcome: "allow",
          title: "ok",
          summary: "ok",
          conclusion: "success",
        },
      }),
    /Checks API post failed/,
  );
});
