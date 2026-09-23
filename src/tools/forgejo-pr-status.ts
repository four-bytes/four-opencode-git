// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import {
  forgejoApi,
  forgejoConfigMessage,
  getForgejoConfig,
  getForgejoRepo,
} from '../lib/forgejo-utils';
import { runGit } from '../lib/git-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface ForgejoPull {
  number: number;
  title: string;
  state: string; // 'open' | 'closed'
  merged: boolean;
  merge_commit_sha?: string | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  additions?: number;
  deletions?: number;
  comments?: number;
  html_url?: string;
}

export interface MergedVia {
  sha: string;
  branch: string;
}

// ────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

/**
 * Return the remote DEFAULT branch carrying a commit — `origin/<baseRef>` — or null.
 * Only the PR's base (remote default) branch counts: a commit reachable from some
 * unrelated `origin/*` branch was NOT merged into the default branch and must be
 * reported as abandoned. `git branch -r --contains` lines may include
 * `origin/HEAD -> origin/main`, which is ignored. Exported for testing.
 */
export function pickContainingBranch(branches: string[], baseRef: string): string | null {
  const cleaned = branches
    .map((b) => b.trim())
    .filter((b) => b !== '' && !b.includes('->'));

  const defaultBranch = `origin/${baseRef}`;
  return cleaned.includes(defaultBranch) ? defaultBranch : null;
}

/** Resolve the single-line state descriptor. Exported for testing. */
export function resolveStateLine(pr: ForgejoPull, mergedVia: MergedVia | null): string {
  if (pr.state === 'open') return 'open';

  if (pr.state === 'closed' && pr.merged) {
    const sha = pr.merge_commit_sha || pr.head.sha;
    return `merged (${shortSha(sha)})`;
  }

  if (pr.state === 'closed' && !pr.merged && mergedVia) {
    return `closed · merged_via git-squash (${shortSha(mergedVia.sha)} on ${mergedVia.branch})`;
  }

  return 'closed';
}

/** Pure 4-line formatter — exported for testing without a repo or API. */
export function formatForgejoPrStatus(pr: ForgejoPull, mergedVia: MergedVia | null): string {
  const lines: string[] = [
    `PR #${pr.number} — ${pr.title}`,
    `  state     ${resolveStateLine(pr, mergedVia)}`,
    `  branch    ${pr.head.ref} → ${pr.base.ref}`,
    `  diff      +${pr.additions ?? 0} -${pr.deletions ?? 0} · ${pr.comments ?? 0} comments`,
  ];
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoPrStatusTool = tool({
  description:
    'Check a Forgejo PR status and resolve merged-vs-abandoned. Forgejo reports an out-of-forge squash-merge as closed + not merged, so this tool checks git for the head commit when needed. Use before branch cleanup.',

  args: {
    pr: tool.schema.number().describe('PR number (index) to check'),
  },

  async execute(args, ctx) {
    const prNum = args.pr as number;
    const cwd = ctx.directory;

    logDebugEvent('forgejo_pr_status.start', { pr: prNum });

    try {
      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return forgejoConfigMessage(cfg.reason);
      const config = cfg.config;

      const repo = await getForgejoRepo(cwd);
      if (!repo) return 'Could not determine Forgejo repository from origin remote.';

      const result = await forgejoApi(`/repos/${repo}/pulls/${prNum}`, config);
      if (!result.ok) return `Failed to get PR #${prNum}: ${result.error}`;

      const pr = result.data as ForgejoPull;

      // The whole point: `fj pr view` shows a squash-merged PR as closed.
      // When the forge says closed + not merged, ask git whether the head
      // commit landed on a remote branch anyway.
      let mergedVia: MergedVia | null = null;
      if (pr.state === 'closed' && pr.merged === false && pr.head?.sha) {
        try {
          const output = await runGit(['branch', '-r', '--contains', pr.head.sha], cwd);
          const branch = pickContainingBranch(output.split('\n'), pr.base.ref);
          if (branch) mergedVia = { sha: pr.head.sha, branch };
        } catch {
          // No git repo / git error — fall back to reporting plain `closed`.
          mergedVia = null;
        }
      }

      logDebugEvent('forgejo_pr_status.done', {
        pr: prNum,
        state: pr.state,
        merged: pr.merged,
        mergedVia: mergedVia?.branch ?? null,
      });
      return formatForgejoPrStatus(pr, mergedVia);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_pr_status.error', { error: msg });
      return `Error checking PR status: ${msg}`;
    }
  },
});
