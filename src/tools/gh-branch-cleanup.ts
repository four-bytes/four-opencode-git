// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface MergedPr {
  number: number;
  headRefName: string;
  baseRefName: string;
  mergedAt: string;
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

function formatBranchCleanup(
  branches: MergedPr[],
  deleted: string[],
  failed: string[],
  dryRun: boolean,
  repo: string
): string {
  const lines: string[] = [];

  if (dryRun) {
    lines.push(`GH BRANCH CLEANUP — ${repo} — DRY RUN`);
    lines.push('');

    if (branches.length === 0) {
      lines.push('  No stale merged branches found.');
      return lines.join('\n');
    }

    lines.push(`  Found ${branches.length} merged branches with closed PRs:`);
    lines.push('');
    for (const b of branches) {
      const dateStr = b.mergedAt.slice(0, 10);
      lines.push(`    • ${b.headRefName} (PR #${b.number} → ${b.baseRefName}, merged ${dateStr})`);
    }
    lines.push('');
    lines.push('  Run with dry_run=false to delete these branches.');
  } else {
    lines.push(`GH BRANCH CLEANUP — ${repo}`);
    lines.push('');

    if (deleted.length > 0) {
      lines.push(`  Deleted ${deleted.length} branch${deleted.length !== 1 ? 'es' : ''}:`);
      for (const d of deleted) {
        lines.push(`    ✓ ${d}`);
      }
    }

    if (failed.length > 0) {
      lines.push('');
      lines.push(`  Failed to delete ${failed.length} branch${failed.length !== 1 ? 'es' : ''}:`);
      for (const f of failed) {
        lines.push(`    ✗ ${f}`);
      }
    }

    if (deleted.length === 0 && failed.length === 0) {
      lines.push('  No stale merged branches to delete.');
    }
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghBranchCleanupTool = tool({
  description:
    'Find and delete stale merged remote branches. Identifies branches whose PRs have been merged but the branch still exists on the remote. Use `dry_run=true` (default) to preview.',

  args: {
    repo: tool.schema
      .string()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
    dry_run: tool.schema
      .boolean()
      .describe('Preview branches without deleting (default: true — SAFETY FIRST)'),
    limit: tool.schema.number().describe('Maximum number of merged PRs to check (default: 50)'),
  },

  async execute(args, ctx) {
    const repo = args.repo as string | undefined;
    const dryRun = (args.dry_run as boolean) ?? true;
    const limit = (args.limit as number) ?? 50;
    const cwd = ctx.directory;

    logDebugEvent('gh_branch_cleanup.start', { dryRun, limit });

    try {
      const resolvedRepo = await resolveRepo(repo, cwd);

      // ── Step 1: List merged PRs ──
      const ghArgs: string[] = [
        'pr',
        'list',
        '--repo',
        resolvedRepo,
        '--state',
        'merged',
        '--limit',
        String(limit),
        '--json',
        'number,headRefName,baseRefName,mergedAt',
      ];

      const rawJson = await runGh(ghArgs, cwd);

      let mergedPrs: MergedPr[];
      try {
        mergedPrs = JSON.parse(rawJson) as MergedPr[];
      } catch {
        return `Error parsing gh pr list output. Raw output:\n${rawJson}`;
      }

      if (mergedPrs.length === 0) {
        return formatBranchCleanup([], [], [], dryRun, resolvedRepo);
      }

      // Filter out branches merged to main or master
      const staleBranches = mergedPrs.filter(
        (pr) => pr.baseRefName === 'main' || pr.baseRefName === 'master'
      );

      if (dryRun) {
        logDebugEvent('gh_branch_cleanup.done', { found: staleBranches.length, dryRun: true });
        return formatBranchCleanup(staleBranches, [], [], true, resolvedRepo);
      }

      // ── Step 2: Delete each stale branch ──
      const deleted: string[] = [];
      const failed: string[] = [];

      for (const pr of staleBranches) {
        const branch = pr.headRefName;
        try {
          await runGh(
            [
              'api',
              `repos/${resolvedRepo}/git/refs/heads/${branch}`,
              '--method',
              'DELETE',
              '--silent',
            ],
            cwd
          );
          deleted.push(branch);
        } catch {
          failed.push(branch);
        }
      }

      logDebugEvent('gh_branch_cleanup.done', { deleted: deleted.length, failed: failed.length });
      return formatBranchCleanup(staleBranches, deleted, failed, false, resolvedRepo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_branch_cleanup.error', { error: msg });
      return `Error cleaning up branches: ${msg}`;
    }
  },
});

export { formatBranchCleanup };
