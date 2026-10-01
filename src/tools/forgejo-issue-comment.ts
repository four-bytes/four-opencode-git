// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { forgejoApi, getForgejoConfig, getForgejoRepo } from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

export const forgejoIssueCommentTool = tool({
  description:
    'Post a comment on a Forgejo issue or pull request (they share one number space). The text is a tool argument sent as JSON — backticks and $() arrive verbatim, no shell involved.',

  args: {
    issue: tool.schema.number().describe('Issue or PR number'),
    body: tool.schema.string().describe('Comment text (markdown)'),
  },

  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const body = (args.body as string) ?? '';
    const cwd = ctx.directory;

    logDebugEvent('forgejo_issue_comment.start', { issue: issueNum });

    try {
      if (!body.trim()) return 'Error: comment body must not be empty.';

      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return cfg.message;

      const repo = await getForgejoRepo(cwd);
      if (!repo) return 'Could not determine Forgejo repository from origin remote.';

      const result = await forgejoApi(`/repos/${repo}/issues/${issueNum}/comments`, cfg.config, {
        method: 'POST',
        body: { body },
      });
      if (!result.ok) return `Error commenting on #${issueNum}: ${result.error}`;

      logDebugEvent('forgejo_issue_comment.done', { issue: issueNum });
      return `✓ Comment posted on #${issueNum}\n  ${result.data?.html_url ?? ''}`.trimEnd();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_issue_comment.error', { error: msg });
      return `Error commenting: ${msg}`;
    }
  },
});
