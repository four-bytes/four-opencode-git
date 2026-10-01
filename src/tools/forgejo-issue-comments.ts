// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import {
  forgejoApi,
  getForgejoConfig,
  getForgejoRepo,
  summarizeBody,
} from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

/**
 * One line per comment, newest `limit` in chronological order:
 * `  2026-06-10 alice: first line… (+3 lines)`. Pure — exported for testing.
 */
export function formatForgejoIssueComments(raw: unknown, issue: number, limit: number): string {
  const all = Array.isArray(raw) ? raw : [];
  if (all.length === 0) return `FORGEJO COMMENTS — #${issue} — none`;

  const shown = all.slice(-limit);
  const header =
    shown.length < all.length
      ? `FORGEJO COMMENTS — #${issue} — last ${shown.length} of ${all.length}`
      : `FORGEJO COMMENTS — #${issue} — ${all.length}`;

  const lines = shown.map((c: any) => {
    const date = typeof c.created_at === 'string' ? c.created_at.slice(0, 10) : '????-??-??';
    const author = c.user?.login ?? 'unknown';
    return `  ${date} ${author}: ${summarizeBody(typeof c.body === 'string' ? c.body : '')}`;
  });

  return [header, '', ...lines].join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoIssueCommentsTool = tool({
  description:
    'Read the comments on a Forgejo issue or PR: one line per comment (date, author, first line of the body), newest N. Use forgejo_issue_view for the issue itself.',

  args: {
    issue: tool.schema.number().describe('Issue or PR number'),
    limit: tool.schema
      .number()
      .optional()
      .describe('How many of the most recent comments to show (default: 10)'),
  },

  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const limit = Math.max(1, (args.limit as number | undefined) ?? 10);
    const cwd = ctx.directory;

    logDebugEvent('forgejo_issue_comments.start', { issue: issueNum, limit });

    try {
      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return cfg.message;

      const repo = await getForgejoRepo(cwd);
      if (!repo) return 'Could not determine Forgejo repository from origin remote.';

      // This endpoint is not paginated — it returns every comment in one response.
      const result = await forgejoApi(`/repos/${repo}/issues/${issueNum}/comments`, cfg.config);
      if (!result.ok) return `Error reading comments on #${issueNum}: ${result.error}`;

      logDebugEvent('forgejo_issue_comments.done', { issue: issueNum });
      return formatForgejoIssueComments(result.data, issueNum, limit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_issue_comments.error', { error: msg });
      return `Error reading comments: ${msg}`;
    }
  },
});
