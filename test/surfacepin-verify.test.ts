import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { verifySurfacePinAtSha } from "../src/check/surfacepinVerify.js";
import type { ContentsFetcher, FetchedFile } from "../src/github/contents.js";

const fixtures = join(process.cwd(), "test/fixtures");
const lockText = readFileSync(join(fixtures, "basic.v3.lock.json"), "utf8");
const toolsText = readFileSync(join(fixtures, "basic.tools.json"), "utf8");
const driftText = readFileSync(join(fixtures, "basic.tools.drift.json"), "utf8");

function memFetcher(files: Record<string, string>): ContentsFetcher {
  return async ({ path }): Promise<FetchedFile> => {
    if (path in files) {
      return { ok: true, content: files[path]!, sha: "deadbeef", path };
    }
    return { ok: false, reason: "missing", detail: "not found", path };
  };
}

test("surfacepin verify: match → ok", async () => {
  const r = await verifySurfacePinAtSha(
    memFetcher({
      "surfacepin.lock.json": lockText,
      "tools.json": toolsText,
    }),
    { owner: "acme", repo: "mcp", sha: "abc" },
    { lockfilePath: "surfacepin.lock.json", surfacePath: "tools.json" },
  );
  assert.equal(r.ok, true);
});

test("surfacepin verify: description drift → drift", async () => {
  const r = await verifySurfacePinAtSha(
    memFetcher({
      "surfacepin.lock.json": lockText,
      "tools.json": driftText,
    }),
    { owner: "acme", repo: "mcp", sha: "abc" },
    { lockfilePath: "surfacepin.lock.json", surfacePath: "tools.json" },
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "drift");
    assert.match(r.detail ?? "", /DRIFT|CHANGED|echo/i);
  }
});

test("surfacepin verify: missing lockfile → missing", async () => {
  const r = await verifySurfacePinAtSha(
    memFetcher({ "tools.json": toolsText }),
    { owner: "acme", repo: "mcp", sha: "abc" },
    { lockfilePath: "surfacepin.lock.json", surfacePath: "tools.json" },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "missing");
});

test("surfacepin verify: missing surface dump → missing", async () => {
  const r = await verifySurfacePinAtSha(
    memFetcher({ "surfacepin.lock.json": lockText }),
    { owner: "acme", repo: "mcp", sha: "abc" },
    { lockfilePath: "surfacepin.lock.json", surfacePath: "tools.json" },
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "missing");
    assert.match(r.detail ?? "", /surface dump/);
  }
});

test("surfacepin verify: empty surfacePath → unreadable fail-closed", async () => {
  const r = await verifySurfacePinAtSha(
    memFetcher({ "surfacepin.lock.json": lockText }),
    { owner: "acme", repo: "mcp", sha: "abc" },
    { lockfilePath: "surfacepin.lock.json", surfacePath: "" },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unreadable");
});

test("surfacepin verify: bad lock JSON → unreadable", async () => {
  const r = await verifySurfacePinAtSha(
    memFetcher({
      "surfacepin.lock.json": "{not-json",
      "tools.json": toolsText,
    }),
    { owner: "acme", repo: "mcp", sha: "abc" },
    { lockfilePath: "surfacepin.lock.json", surfacePath: "tools.json" },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unreadable");
});
