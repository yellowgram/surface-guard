import type { Decision } from "../errors.js";
import { formatOctokitError, type GuardOctokit } from "./octokit.js";

export type PostCheckParams = {
  owner: string;
  repo: string;
  sha: string;
  decision: Decision;
  /** Check run name shown in GitHub UI. */
  name?: string;
};

export type PostCheckResult = { id: number; htmlUrl?: string | null };

/**
 * Post a completed Checks API run for the Surface Guard decision.
 * Always posts (allow and deny) so the PR never silently lacks a verdict.
 */
export async function postSurfaceGuardCheck(
  octokit: GuardOctokit,
  params: PostCheckParams,
): Promise<PostCheckResult> {
  try {
    const { data } = await octokit.rest.checks.create({
      owner: params.owner,
      repo: params.repo,
      name: params.name ?? "Surface Guard",
      head_sha: params.sha,
      status: "completed",
      conclusion: params.decision.conclusion,
      output: {
        title: params.decision.title,
        summary: params.decision.summary,
      },
    });
    return { id: data.id, htmlUrl: data.html_url };
  } catch (err) {
    throw new Error(`Checks API post failed: ${formatOctokitError(err)}`);
  }
}
