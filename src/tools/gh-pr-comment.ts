// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

export const ghPrCommentTool = tool({
  description:
    'Add a comment to a GitHub pull request, or reply to a specific inline review comment thread. Saves ~90% tokens vs. bash→read→parse.',

  args: {
    pr: tool.schema.number().describe('PR number to comment on'),
    body: tool.schema.string().describe('Comment text (markdown)'),
    repo: tool.schema
      .string()
      .optional()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
    inReplyTo: tool.schema
      .number()
      .optional()
      .describe('Review comment ID to reply to (for inline review threads). ' +
        'When set, the comment is posted as a reply to that specific review comment instead of a general PR comment.'),
  },

  async execute(args, ctx) {
    const { pr, body, repo, inReplyTo } = args;

    if (inReplyTo !== undefined) {
      // ── Reply to a specific inline review comment thread ──
      logDebugEvent('gh_pr_comment.inline.start', { pr, inReplyTo });

      try {
        const resolvedRepo = await resolveRepo(repo, ctx.directory);
        const apiPath = `repos/${resolvedRepo}/pulls/${pr}/comments/${inReplyTo}/replies`;

        const output = await runGh(
          ['api', apiPath, '--method', 'POST', '-f', `body=${body}`],
          ctx.directory
        );

        logDebugEvent('gh_pr_comment.inline.success', { pr, inReplyTo });
        return `✅ Replied to review comment #${inReplyTo} on PR #${pr}. ${output.trim()}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logDebugEvent('gh_pr_comment.inline.error', { error: msg, pr, inReplyTo });
        return `Error replying to review comment #${inReplyTo} on PR #${pr}: ${msg}`;
      }
    }

    // ── Original behavior: general PR comment ──
    logDebugEvent('gh_pr_comment.start', { pr });

    try {
      const resolvedRepo = await resolveRepo(repo, ctx.directory);
      const repoArgs = ['-R', resolvedRepo];

      const output = await runGh(
        ['pr', 'comment', String(pr), ...repoArgs, '--body', body],
        ctx.directory
      );

      logDebugEvent('gh_pr_comment.success', { pr });
      return `✅ Comment added to PR #${pr}. ${output.trim()}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_pr_comment.error', { error: msg });
      return `Error commenting on PR: ${msg}`;
    }
  },
});
