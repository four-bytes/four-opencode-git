// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

export const ghPrCommentTool = tool({
  description: 'Add a comment to a GitHub pull request. Saves ~90% tokens vs. bash→read→parse.',

  args: {
    pr: tool.schema.number().describe('PR number to comment on'),
    body: tool.schema.string().describe('Comment text (markdown)'),
    repo: tool.schema
      .string()
      .optional()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
  },

  async execute(args, ctx) {
    const { pr, body, repo } = args;

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
