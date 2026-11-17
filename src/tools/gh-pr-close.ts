// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface PrView {
  number: number;
  title: string;
  state: string;
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghPrCloseTool = tool({
  description:
    'Close a GitHub pull request WITHOUT merging (abandoned work), with an optional comment explaining why. The comment is a tool argument — no shell. To merge, use gh_pr_merge.',

  args: {
    pr: tool.schema.number().describe('PR number to close'),
    comment: tool.schema.string().optional().describe('Optional comment to post before closing'),
    repo: tool.schema
      .string()
      .optional()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
  },

  async execute(args, ctx) {
    const n = args.pr as number;
    const comment = args.comment as string | undefined;
    const repo = args.repo as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('gh_pr_close.start', { pr: n, hasComment: !!comment });

    try {
      const resolvedRepo = await resolveRepo(repo, cwd);

      const rawJson = await runGh(
        ['pr', 'view', String(n), '--repo', resolvedRepo, '--json', 'number,title,state'],
        cwd
      );

      let pr: PrView;
      try {
        pr = JSON.parse(rawJson) as PrView;
      } catch {
        return `Error parsing gh pr view output. Raw output:\n${rawJson}`;
      }

      if (pr.state === 'MERGED') return `PR #${n} is already merged. Nothing to close.`;
      if (pr.state === 'CLOSED') return `PR #${n} is already closed. Nothing to do.`;

      const lines: string[] = [];

      if (comment?.trim()) {
        try {
          await runGh(['pr', 'comment', String(n), '--repo', resolvedRepo, '--body', comment], cwd);
          lines.push(`✓ Comment posted on #${n}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lines.push(`⚠ Failed to post comment: ${msg}`);
        }
      }

      try {
        await runGh(['pr', 'close', String(n), '--repo', resolvedRepo], cwd);
        lines.push(`✓ PR #${n} "${pr.title}" closed without merging.`);
        logDebugEvent('gh_pr_close.done', { pr: n });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(`✗ Failed to close PR #${n}: ${msg}`);
      }

      return lines.join('\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_pr_close.error', { error: msg });
      return `Error closing PR: ${msg}`;
    }
  },
});
