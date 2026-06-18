// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface ReviewInfo {
  author: string;
  state: string;
  submittedAt?: string;
}

interface CheckInfo {
  name: string;
  status: string;
  conclusion: string | null;
}

interface PrView {
  number: number;
  title: string;
  state: string;
  mergeable: string; // 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeStateStatus: string;
  reviews: ReviewInfo[];
  statusCheckRollup: CheckInfo[] | null;
  url: string;
  baseRefName: string;
  headRefName: string;
}

// ────────────────────────────────────────────────────────────────
// Helper: format mergeability status
// ────────────────────────────────────────────────────────────────

function mergeableIcon(status: string): string {
  switch (status) {
    case 'MERGEABLE':
      return '✅';
    case 'CONFLICTING':
      return '❌';
    default:
      return '❓';
  }
}

function mergeStateLabel(status: string): string {
  switch (status) {
    case 'CLEAN':
      return 'ready to merge';
    case 'BLOCKED':
      return 'blocked';
    case 'BEHIND':
      return 'behind base';
    case 'DIRTY':
      return 'needs update';
    case 'HAS_HOOKS':
      return 'hooks running';
    case 'UNKNOWN':
      return 'unknown state';
    case 'UNSTABLE':
      return 'merging into a non-stable branch';
    default:
      return status.toLowerCase();
  }
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

function formatPrStatus(pr: PrView, repo: string): string {
  const lines: string[] = [];

  lines.push(`PR STATUS — ${repo} #${pr.number}`);
  lines.push('');
  lines.push(`  Title:      ${pr.title}`);
  lines.push(`  State:      ${pr.state.toUpperCase()}`);
  lines.push(`  Branch:     ${pr.headRefName} → ${pr.baseRefName}`);
  lines.push(`  Mergeable:  ${mergeableIcon(pr.mergeable)} ${pr.mergeable}`);
  lines.push(`  Status:     ${mergeStateLabel(pr.mergeStateStatus)}`);
  lines.push(`  URL:        ${pr.url}`);
  lines.push('');

  // ── Reviews ──
  if (pr.reviews && pr.reviews.length > 0) {
    const approved = pr.reviews.filter((r) => r.state === 'APPROVED');
    const changesRequested = pr.reviews.filter((r) => r.state === 'CHANGES_REQUESTED');
    const commented = pr.reviews.filter((r) => r.state === 'COMMENTED');

    lines.push('  Reviews:');
    if (approved.length > 0) {
      lines.push(
        `    ✅ ${approved.length} approval${approved.length !== 1 ? 's' : ''} (${approved.map((r) => r.author).join(', ')})`
      );
    }
    if (changesRequested.length > 0) {
      lines.push(
        `    ❌ ${changesRequested.length} change${changesRequested.length !== 1 ? 's' : ''} requested (${changesRequested.map((r) => r.author).join(', ')})`
      );
    }
    if (commented.length > 0) {
      lines.push(
        `    💬 ${commented.length} comment${commented.length !== 1 ? 's' : ''} without decision (${commented.map((r) => r.author).join(', ')})`
      );
    }
  } else {
    lines.push('  Reviews:    none yet');
  }

  lines.push('');

  // ── CI Status ──
  if (pr.statusCheckRollup && pr.statusCheckRollup.length > 0) {
    lines.push('  CI Checks:');
    for (const check of pr.statusCheckRollup) {
      let icon: string;
      if (check.status === 'COMPLETED') {
        icon = check.conclusion === 'SUCCESS' ? '✅' : check.conclusion === 'FAILURE' ? '❌' : '⚠️';
      } else if (check.status === 'IN_PROGRESS') {
        icon = '🔄';
      } else {
        icon = '⏳';
      }
      const conclusion = check.conclusion ? ` — ${check.conclusion}` : '';
      lines.push(`    ${icon} ${check.name} (${check.status}${conclusion})`);
    }
  } else {
    lines.push('  CI Checks:  none configured');
  }

  lines.push('');

  // ── Merge recommendation ──
  const hasApproval = (pr.reviews || []).some((r) => r.state === 'APPROVED');
  const hasChangesRequested = (pr.reviews || []).some((r) => r.state === 'CHANGES_REQUESTED');
  const ciFailed = (pr.statusCheckRollup || []).some(
    (c) => c.status === 'COMPLETED' && c.conclusion === 'FAILURE'
  );
  const ciPending = (pr.statusCheckRollup || []).some(
    (c) => c.status === 'IN_PROGRESS' || c.status === 'PENDING'
  );

  lines.push('  ── Merge Readiness ──');

  if (pr.mergeable === 'UNKNOWN') {
    lines.push('  ❓ Mergeability unknown');
  } else if (pr.mergeable === 'CONFLICTING') {
    lines.push('  ❌ Has merge conflicts — resolve before merging');
  } else if (hasChangesRequested) {
    lines.push('  ❌ Changes requested — address review feedback');
  } else if (ciFailed) {
    lines.push('  ❌ CI checks failing — fix before merging');
  } else if (!hasApproval) {
    lines.push('  ⏳ Waiting for review approval');
  } else if (ciPending) {
    lines.push('  ⏳ CI checks still running');
  } else if (pr.mergeable === 'MERGEABLE' && pr.mergeStateStatus === 'CLEAN') {
    lines.push('  ✅ Ready to merge! All checks passed, approved, no conflicts');
  } else if (pr.mergeable === 'MERGEABLE') {
    lines.push('  ⚠️  Mergeable but not clean — status: ' + mergeStateLabel(pr.mergeStateStatus));
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghPrStatusTool = tool({
  description:
    'Check PR mergeability status — reviews, CI checks, conflicts. Wraps `gh pr view --json` into structured output. Saves ~90% tokens vs. bash→read→parse. Use before merging any PR.',

  args: {
    pr: tool.schema.number().describe('PR number to check'),
    repo: tool.schema
      .string()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
  },

  async execute(args, ctx) {
    const prNum = args.pr as number;
    const repo = args.repo as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('gh_pr_status.start', { pr: prNum });

    try {
      const resolvedRepo = await resolveRepo(repo, cwd);

      const ghArgs: string[] = [
        'pr',
        'view',
        String(prNum),
        '--repo',
        resolvedRepo,
        '--json',
        'number,title,state,mergeable,mergeStateStatus,reviews,statusCheckRollup,url,baseRefName,headRefName',
      ];

      const rawJson = await runGh(ghArgs, cwd);

      let pr: PrView;
      try {
        pr = JSON.parse(rawJson) as PrView;
      } catch {
        return `Error parsing gh pr view output. Raw output:\n${rawJson}`;
      }

      logDebugEvent('gh_pr_status.done', { pr: prNum, mergeable: pr.mergeable });
      return formatPrStatus(pr, resolvedRepo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_pr_status.error', { error: msg });
      return `Error checking PR status: ${msg}`;
    }
  },
});

export { formatPrStatus };
