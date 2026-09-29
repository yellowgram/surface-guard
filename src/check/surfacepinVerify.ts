import { verify, formatDiff } from "surfacepin";
import type { ContentsFetcher } from "../github/contents.js";
import type { VerifyResult } from "./runCheck.js";

export type SurfacePinVerifyPaths = {
  lockfilePath: string;
  /** Path to the surface dump JSON (tools / combined). Required for file-mode verify. */
  surfacePath: string;
};

/**
 * Fetch lockfile + surface dump at SHA, then run SurfacePin verify (digest equality).
 * Fail closed on missing files, parse errors, or library throws — never invent ok:true.
 */
export async function verifySurfacePinAtSha(
  fetchFile: ContentsFetcher,
  ctx: {
    owner: string;
    repo: string;
    sha: string;
  },
  paths: SurfacePinVerifyPaths,
): Promise<VerifyResult> {
  const lockPath = (paths.lockfilePath ?? "").trim();
  const surfacePath = (paths.surfacePath ?? "").trim();

  if (!lockPath) {
    return {
      ok: false,
      reason: "unreadable",
      detail: "SURFACE_GUARD_LOCKFILE_PATH is empty. Fail closed.",
    };
  }
  if (!surfacePath) {
    return {
      ok: false,
      reason: "unreadable",
      detail:
        "SURFACE_GUARD_SURFACE_PATH is empty. File-mode verify needs a committed surface dump JSON next to the lockfile. Fail closed — App does not spawn customer MCP servers.",
    };
  }

  const lockFetched = await fetchFile({
    owner: ctx.owner,
    repo: ctx.repo,
    path: lockPath,
    ref: ctx.sha,
  });
  if (!lockFetched.ok) {
    return {
      ok: false,
      reason: lockFetched.reason === "missing" ? "missing" : "unreadable",
      detail: `lockfile ${lockPath}: ${lockFetched.detail}`,
    };
  }

  const surfaceFetched = await fetchFile({
    owner: ctx.owner,
    repo: ctx.repo,
    path: surfacePath,
    ref: ctx.sha,
  });
  if (!surfaceFetched.ok) {
    return {
      ok: false,
      reason: surfaceFetched.reason === "missing" ? "missing" : "unreadable",
      detail: `surface dump ${surfacePath}: ${surfaceFetched.detail}`,
    };
  }

  let lockJson: unknown;
  let surfaceJson: unknown;
  try {
    lockJson = JSON.parse(lockFetched.content);
  } catch (err) {
    return {
      ok: false,
      reason: "unreadable",
      detail: `lockfile JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    surfaceJson = JSON.parse(surfaceFetched.content);
  } catch (err) {
    return {
      ok: false,
      reason: "unreadable",
      detail: `surface dump JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    const result = verify(surfaceJson, lockJson);
    if (result.ok) {
      return { ok: true };
    }
    let detail: string;
    try {
      detail = formatDiff(result.diff);
    } catch {
      detail = "SurfacePin digest mismatch (formatDiff unavailable)";
    }
    return { ok: false, reason: "drift", detail };
  } catch (err) {
    return {
      ok: false,
      reason: "unreadable",
      detail: `surfacepin.verify threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
