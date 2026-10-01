// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { forgejoApi, getForgejoConfig, getForgejoRepo } from '../lib/forgejo-utils';
import { blocksMerge, fetchReviewSummary, formatReviewLine } from '../lib/forgejo-reviews';
import { logDebugEvent } from '../lib/debug-logger';

const METHODS = ['squash', 'merge', 'rebase', 'rebase-merge', 'fast-forward-only'] as const;
type Method = (typeof METHODS)[number];

/** Pre-merge refusal, or null when the PR may be merged. Pure — exported for testing. */
export function preMergeRefusal(pr: any): string | null {
  const n = pr?.number;
  if (pr?.merged === true) return `PR !${n} is already merged. Nothing to do.`;
  if (pr?.state !== 'open') return `✗ PR !${n} is ${pr?.state ?? 'not open'} — not merged.`;
  if (!pr?.head?.sha) return `✗ PR !${n} has no head commit in the API response — not merged.`;
  if (pr?.mergeable === false) {
    return `✗ PR !${n} is not mergeable (conflicts or failing branch protection) — rebase on ${pr?.base?.ref ?? 'base'} and push first.`;
  }
  return null;
}

/** Map a failed merge call to one line. Pure — exported for testing. */
export function formatMergeError(n: number, method: Method, status: number, error?: string): string {
  const detail = error ? `: ${error}` : '';
  if (status === 405) {
    return `✗ Forgejo refused the merge of !${n} (405${detail}). Check that the repo allows "${method}" merges (Settings → Repository → Pull requests) that required approvals / status checks are met, and that the PR is not marked work-in-progress.`;
  }
  if (status === 409) {
    return `✗ Merge of !${n} conflicted (409${detail}) — the head moved or the branch has conflicts. Re-check with forgejo_pr_status.`;
  }
  return `✗ Merge of !${n} failed (HTTP ${status}${detail}).`;
}

export const forgejoPrMergeTool = tool({
  description:
    'Merge a Forgejo pull request through the API (default: squash + delete branch). Refuses when the PR is closed, not mergeable, or has an open human review thread / requested changes. A successful API merge marks the PR "merged" and closes issues referenced with "Closes #N". Local cleanup (checkout main, pull, delete branch) stays with git. Merge only after the local gate decided to.',

  args: {
    pr: tool.schema.number().describe('PR number to merge'),
    method: tool.schema.enum(METHODS, 'Merge style (default: squash)').optional(),
    title: tool.schema
      .string()
      .optional()
      .describe('Merge commit title (default: PR title), e.g. "feat: short desc (#12)"'),
    message: tool.schema
      .string()
      .optional()
      .describe('Merge commit message (default: PR body, keeps "Closes #N")'),
    delete_branch: tool.schema
      .boolean()
      .optional()
      .describe('Delete the head branch after merging (default: true)'),
  },

  async execute(args, ctx) {
    const n = args.pr as number;
    const method = ((args.method as Method | undefined) ?? 'squash') as Method;
    const deleteBranch = (args.delete_branch as boolean | undefined) ?? true;
    const cwd = ctx.directory;

    logDebugEvent('forgejo_pr_merge.start', { pr: n, method, deleteBranch });

    try {
      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return cfg.message;
      const config = cfg.config;

      const repo = await getForgejoRepo(cwd);
      if (!repo) return 'Could not determine Forgejo repository from origin remote.';

      const view = await forgejoApi(`/repos/${repo}/pulls/${n}`, config);
      if (!view.ok) return `Failed to get PR !${n}: ${view.error}`;
      const pr = view.data;

      const refusal = preMergeRefusal(pr);
      if (refusal) return refusal;

      // An open human thread blocks the merge regardless of score. If the
      // reviews cannot be read, refuse rather than merge blind.
      const reviews = await fetchReviewSummary(repo, n, pr?.user?.login ?? '', config);
      if (!reviews) return `✗ Could not read reviews of !${n} — not merged.`;
      if (blocksMerge(reviews)) return `✗ PR !${n} not merged: ${formatReviewLine(reviews)}.`;

      const result = await forgejoApi(`/repos/${repo}/pulls/${n}/merge`, config, {
        method: 'POST',
        body: {
          Do: method,
          MergeTitleField: (args.title as string | undefined)?.trim() || pr.title,
          MergeMessageField: (args.message as string | undefined) ?? pr.body ?? '',
          delete_branch_after_merge: deleteBranch,
          head_commit_id: pr?.head?.sha,
        },
      });
      if (!result.ok) return formatMergeError(n, method, result.status, result.error);

      // Read back the merge commit — the merge call itself returns no body.
      const after = await forgejoApi(`/repos/${repo}/pulls/${n}`, config);
      const sha = after.ok && after.data?.merge_commit_sha ? ` (${String(after.data.merge_commit_sha).slice(0, 8)})` : '';
      const branchNote = deleteBranch ? ` · branch ${pr?.head?.ref} deleted on the remote` : '';

      logDebugEvent('forgejo_pr_merge.done', { pr: n });
      return [
        `✓ PR !${n} merged via ${method}${sha} into ${pr?.base?.ref}${branchNote}.`,
        `  local cleanup: git checkout ${pr?.base?.ref} && git pull --ff-only && git branch -D ${pr?.head?.ref} && git fetch --prune`,
      ].join('\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_pr_merge.error', { error: msg });
      return `Error merging PR: ${msg}`;
    }
  },
});
