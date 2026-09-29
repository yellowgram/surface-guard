import { RequestError, formatOctokitError, type GuardOctokit } from "./octokit.js";

export type FetchedFile =
  | { ok: true; content: string; sha: string; path: string }
  | { ok: false; reason: "missing" | "unreadable"; detail: string; path: string };

export type ContentsFetcher = (params: {
  owner: string;
  repo: string;
  path: string;
  ref: string;
}) => Promise<FetchedFile>;

/**
 * Fetch a single text file at a commit SHA via Contents API.
 * Fail closed: 404 → missing; directory / non-file / decode error → unreadable.
 */
export function makeContentsFetcher(octokit: GuardOctokit): ContentsFetcher {
  return async (params) => fetchRepoFileText(octokit, params);
}

export async function fetchRepoFileText(
  octokit: GuardOctokit,
  params: { owner: string; repo: string; path: string; ref: string },
): Promise<FetchedFile> {
  const path = params.path.replace(/^\/+/, "");
  if (!path) {
    return { ok: false, reason: "unreadable", detail: "empty file path", path };
  }
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path,
      ref: params.ref,
    });

    if (Array.isArray(data)) {
      return {
        ok: false,
        reason: "unreadable",
        detail: `path is a directory, expected a file`,
        path,
      };
    }
    if (data.type !== "file" || typeof data.content !== "string") {
      return {
        ok: false,
        reason: "unreadable",
        detail: `contents API returned type=${(data as { type?: string }).type ?? "unknown"}, expected file`,
        path,
      };
    }

    const encoding = (data.encoding ?? "base64") as BufferEncoding | "base64";
    let content: string;
    try {
      if (encoding === "base64") {
        content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
      } else {
        content = Buffer.from(data.content, encoding).toString("utf8");
      }
    } catch (err) {
      return {
        ok: false,
        reason: "unreadable",
        detail: `decode failed: ${err instanceof Error ? err.message : String(err)}`,
        path,
      };
    }

    return { ok: true, content, sha: data.sha, path };
  } catch (err) {
    if (err instanceof RequestError && err.status === 404) {
      return {
        ok: false,
        reason: "missing",
        detail: `not found at ref=${params.ref}`,
        path,
      };
    }
    return {
      ok: false,
      reason: "unreadable",
      detail: formatOctokitError(err),
      path,
    };
  }
}
