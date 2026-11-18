// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import {
  fetchGhReviewSummary,
  formatGhReviewLine,
} from '../lib/gh-reviews';
import { logDebugEvent } from '../lib/debug-logger';

const METHODS = ['squash', 'merge', 'rebase'] as const;
type Method = (typeof METHODS)[number];

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface PrView {
  number: number;
  title: string;
  state: string;
  mergeable: string; // 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeStateStatus: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  author: { login: string } | null;
}

// ────────────────────────────────────────────────────────────────
// Pre-merge gating
// ────────────────────────────────────────────────────────────────

/** Pre-merge refusal, or null when the PR may be merged. Pure — exported for testing. */
export function preMergeRefusal(pr: any): string | null {
  const n = pr?.number;
  if (pr?.state === 'MERGED') return `PR #${n} is already merged. Nothing to do.`;
  if (pr?.state !== 'OPEN') return `✗ PR #${n} is ${pr?.state ?? 'not open'} — not merged.`;
  if (pr?.mergeable === 'CONFLICTING') {
    return `✗ PR #${n} has merge conflicts — rebase on ${pr?.baseRefName ?? 'base'} and push first.`;
  }
  if (pr?.mergeStateStatus === 'BLOCKED') {
    return `✗ PR #${n} is blocked by branch protection (required reviews or status checks) — not merged.`;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────
// Core — reusable, takes an already-resolved repo
// ────────────────────────────────────────────────────────────────

/** Gate + merge a GitHub PR via the gh CLI. gh supports only squash|merge|rebase. */
export async function mergeGhPr(
  repo: string,
  prNum: number,
  method: string,
  title: string | undefined,
  message: string | undefined,
  deleteBranch: boolean,
  cwd: string
): Promise<string> {
  const rawJson = await runGh(
    [
      'pr',
      'view',
      String(prNum),
      '--repo',
      repo,
      '--json',
      'number,title,state,mergeable,mergeStateStatus,url,baseRefName,headRefName,author',
    ],
    cwd
  );

  let pr: PrView;
  try {
    pr = JSON.parse(rawJson) as PrView;
  } catch {
    return `Error parsing gh pr view output. Raw output:\n${rawJson}`;
  }

  const refusal = preMergeRefusal(pr);
  if (refusal) return refusal;

  // An open human thread or requested changes blocks the merge. If the
  // reviews cannot be read, refuse rather than merge blind.
  const author = pr?.author?.login ?? '';
  const summary = await fetchGhReviewSummary(repo, prNum, author, cwd);
  if (!summary) return `✗ Could not read reviews of PR #${prNum} — not merged.`;
  if (summary.openHumanThreads.length > 0 || summary.changesRequestedBy.length > 0) {
    return `✗ PR #${prNum} not merged: ${formatGhReviewLine(summary)}.`;
  }

  const mergeArgs: string[] = ['pr', 'merge', String(prNum), '--repo', repo, `--${method}`];
  if (deleteBranch) mergeArgs.push('--delete-branch');
  // --subject/--body set the merge/squash commit message; a rebase produces no
  // merge commit, so gh would ignore or reject them.
  if (method !== 'rebase') {
    const trimmedTitle = title?.trim();
    if (trimmedTitle) mergeArgs.push('--subject', trimmedTitle);
    if (message !== undefined) mergeArgs.push('--body', message);
  }

  await runGh(mergeArgs, cwd);

  const branchNote = deleteBranch ? ` · branch ${pr.headRefName} deleted on the remote` : '';

  logDebugEvent('gh_pr_merge.done', { pr: prNum, method });
  return [
    `✓ PR #${prNum} "${pr.title}" merged via ${method} into ${pr.baseRefName}${branchNote}.`,
    `  local cleanup: git checkout ${pr.baseRefName} && git pull --ff-only && git branch -D ${pr.headRefName} && git fetch --prune`,
  ].join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghPrMergeTool = tool({
  description:
    'Merge a GitHub pull request through the gh CLI (default: squash + delete branch). Refuses when the PR is merged, not open, conflicting, blocked by branch protection, or has requested changes / an open human review thread (bot findings never block). A successful merge closes issues referenced with "Closes #N". Local cleanup (checkout base, pull, delete branch) stays with git. Merge only after the local gate decided to.',

  args: {
    pr: tool.schema.number().describe('PR number to merge'),
    method: tool.schema.enum(METHODS, 'Merge style (default: squash)').optional(),
    title: tool.schema
      .string()
      .optional()
      .describe('Merge commit subject (default: PR title), e.g. "feat: short desc (#12)"'),
    message: tool.schema
      .string()
      .optional()
      .describe('Merge commit body (default: PR body, keeps "Closes #N")'),
    delete_branch: tool.schema
      .boolean()
      .optional()
      .describe('Delete the head branch after merging (default: true)'),
    repo: tool.schema
      .string()
      .optional()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
  },

  async execute(args, ctx) {
    const n = args.pr as number;
    const method = ((args.method as Method | undefined) ?? 'squash') as Method;
    const deleteBranch = (args.delete_branch as boolean | undefined) ?? true;
    const repo = args.repo as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('gh_pr_merge.start', { pr: n, method, deleteBranch });

    try {
      const resolvedRepo = await resolveRepo(repo, cwd);
      return await mergeGhPr(
        resolvedRepo,
        n,
        method,
        args.title as string | undefined,
        args.message as string | undefined,
        deleteBranch,
        cwd
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_pr_merge.error', { error: msg });
      return `Error merging PR: ${msg}`;
    }
  },
});
