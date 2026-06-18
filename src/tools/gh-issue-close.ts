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
  closedByPullRequestsUrls: string[];
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
    const issueNum = args.issue as number;
    const reason = ((args.reason as string) ?? 'completed').toLowerCase();
    const comment = args.comment as string | undefined;
    const repo = args.repo as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('gh_issue_close.start', { issue: issueNum, reason, hasComment: !!comment });

    try {
      const resolvedRepo = await resolveRepo(repo, cwd);

      // Validate reason
      if (!['completed', 'not planned'].includes(reason)) {
        return `Error: Invalid reason "${reason}". Must be "completed" or "not planned".`;
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
            resolvedRepo,
            '--json',
            'number,title,state,closedByPullRequestsUrls',
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
      const urls = issueView.closedByPullRequestsUrls || [];
      const isZombie = urls.length > 0;

      let outputLines: string[] = [];

      if (isZombie) {
        outputLines.push('⚠️  ZOMBIE ISSUE DETECTED');
        outputLines.push(`   Issue #${issueNum} "${issueView.title}" was closed by merged PR(s):`);
        for (const url of urls) {
          outputLines.push(`   • ${url}`);
        }
        outputLines.push('   The associated PR is merged but the issue remained open.');
        outputLines.push('');
      }

      // ── Step 3: Post optional comment ──
      if (comment) {
        try {
          await runGh(
            ['issue', 'comment', String(issueNum), '--repo', resolvedRepo, '--body', comment],
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
          ['issue', 'close', String(issueNum), '--repo', resolvedRepo, '--reason', reason],
          cwd
        );
        outputLines.push(`✓ Issue #${issueNum} "${issueView.title}" closed as "${reason}"`);
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
  },
});
