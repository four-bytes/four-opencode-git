// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface IssueView {
  number: number;
  title: string;
  state: string;
  closedByPullRequestsReferences: Array<{ number: number; url: string }>;
}

// ────────────────────────────────────────────────────────────────
// Core — reusable, takes an already-resolved repo
// ────────────────────────────────────────────────────────────────

/**
 * Close a GitHub issue with optional comment and zombie detection.
 * `reason` is `completed` / `not planned` (default: `completed`).
 */
export async function closeGhIssue(
  repo: string,
  issueNum: number,
  reason: string | undefined,
  comment: string | undefined,
  cwd: string
): Promise<string> {
  const normalizedReason = (reason ?? 'completed').toLowerCase();

  logDebugEvent('gh_issue_close.start', {
    issue: issueNum,
    reason: normalizedReason,
    hasComment: !!comment,
  });

  try {
    // Validate reason
    if (!['completed', 'not planned'].includes(normalizedReason)) {
      return `Error: Invalid reason "${normalizedReason}". Must be "completed" or "not planned".`;
    }

    // ── Step 1: Check if issue is already closed ──
    let issueView: IssueView;
    try {
      const viewJson = await runGh(
        [
          'issue',
          'view',
          String(issueNum),
          '--repo',
          repo,
          '--json',
          'number,title,state,closedByPullRequestsReferences',
        ],
        cwd
      );
      issueView = JSON.parse(viewJson) as IssueView;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error viewing issue #${issueNum}: ${msg}`;
    }

    if (issueView.state === 'closed') {
      return `Issue #${issueNum} "${issueView.title}" is already closed. Nothing to do.`;
    }

    // ── Step 2: Zombie detection ──
    const refs = issueView.closedByPullRequestsReferences || [];
    const isZombie = refs.length > 0;

    let outputLines: string[] = [];

    if (isZombie) {
      outputLines.push('⚠️  ZOMBIE ISSUE DETECTED');
      outputLines.push(`   Issue #${issueNum} "${issueView.title}" was closed by merged PR(s):`);
      for (const ref of refs) {
        outputLines.push(`   • ${ref.url} (PR #${ref.number})`);
      }
      outputLines.push('   The associated PR is merged but the issue remained open.');
      outputLines.push('');
    }

    // ── Step 3: Post optional comment ──
    if (comment) {
      try {
        await runGh(
          ['issue', 'comment', String(issueNum), '--repo', repo, '--body', comment],
          cwd
        );
        outputLines.push(`✓ Comment posted on #${issueNum}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputLines.push(`⚠ Failed to post comment: ${msg}`);
      }
    }

    // ── Step 4: Close the issue ──
    try {
      await runGh(
        ['issue', 'close', String(issueNum), '--repo', repo, '--reason', normalizedReason],
        cwd
      );
      outputLines.push(`✓ Issue #${issueNum} "${issueView.title}" closed as "${normalizedReason}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputLines.push(`✗ Failed to close issue: ${msg}`);
      return outputLines.join('\n');
    }

    logDebugEvent('gh_issue_close.done', { issue: issueNum, zombie: isZombie });
    return outputLines.join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logDebugEvent('gh_issue_close.error', { error: msg });
    return `Error closing issue: ${msg}`;
  }
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghIssueCloseTool = tool({
  description:
    'Close a GitHub issue with optional comment. Auto-detects zombie issues (merged PR but issue still open). Saves ~90% tokens vs. bash→read→parse. Use for issue lifecycle management.',

  args: {
    issue: tool.schema.number().describe('Issue number to close'),
    reason: tool.schema
      .string()
      .describe("Close reason: 'completed' or 'not planned' (default: 'completed')"),
    comment: tool.schema.string().describe('Optional comment to post before closing'),
    repo: tool.schema
      .string()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
  },

  async execute(args, ctx) {
    const repo = args.repo as string | undefined;
    const cwd = ctx.directory;

    try {
      const resolvedRepo = await resolveRepo(repo, cwd);
      return await closeGhIssue(
        resolvedRepo,
        args.issue as number,
        args.reason as string | undefined,
        args.comment as string | undefined,
        cwd
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_issue_close.error', { error: msg });
      return `Error closing issue: ${msg}`;
    }
  },
});
