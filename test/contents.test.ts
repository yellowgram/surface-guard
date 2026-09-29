import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchRepoFileText } from "../src/github/contents.js";
import { RequestError } from "../src/github/octokit.js";
import type { GuardOctokit } from "../src/github/octokit.js";

function fakeOctokit(handler: (args: unknown) => unknown): GuardOctokit {
  return {
    rest: {
      repos: {
        getContent: async (args: unknown) => handler(args),
      },
    },
  } as unknown as GuardOctokit;
}

test("contents: decodes base64 file", async () => {
  const body = "hello surface";
  const octokit = fakeOctokit(() => ({
    data: {
      type: "file",
      encoding: "base64",
      content: Buffer.from(body, "utf8").toString("base64"),
      sha: "s1",
    },
  }));
  const r = await fetchRepoFileText(octokit, {
    owner: "acme",
    repo: "mcp",
    path: "tools.json",
    ref: "abc",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.content, body);
    assert.equal(r.sha, "s1");
  }
});

test("contents: 404 → missing", async () => {
  const octokit = fakeOctokit(() => {
    throw new RequestError("Not Found", 404, {
      request: { method: "GET", url: "https://api.github.com", headers: {} },
      response: { url: "https://api.github.com", status: 404, headers: {}, data: {} },
    });
  });
  const r = await fetchRepoFileText(octokit, {
    owner: "acme",
    repo: "mcp",
    path: "missing.json",
    ref: "abc",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "missing");
});

test("contents: directory listing → unreadable", async () => {
  const octokit = fakeOctokit(() => ({ data: [{ name: "a" }, { name: "b" }] }));
  const r = await fetchRepoFileText(octokit, {
    owner: "acme",
    repo: "mcp",
    path: "dir",
    ref: "abc",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unreadable");
});
