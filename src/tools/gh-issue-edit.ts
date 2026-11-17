// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

/** Success line naming the fields that changed. Pure — exported for testing. */
export function formatGhIssueEdited(issue: number, fields: string[]): string {
  return `✓ Issue #${issue} updated (${fields.join(', ')}).`;
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghIssueEditTool = tool({
  description:
    'Edit a GitHub issue title/body (e.g. body correction). Saves ~90% tokens vs. bash→read→parse.',

  args: {
    issue: tool.schema.number().describe('Issue number to edit'),
    body: tool.schema.string().optional().describe('New issue body (markdown)'),
    title: tool.schema.string().optional().describe('New issue title'),
    repo: tool.schema
      .string()
      .optional()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
  },

  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const body = args.body as string | undefined;
    const title = (args.title as string | undefined)?.trim();
    const repo = args.repo as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('gh_issue_edit.start', { issue: issueNum, hasBody: body !== undefined, hasTitle: !!title });

    try {
      if (body === undefined && !title) {
        return 'Error: nothing to update — pass body and/or title.';
      }

      const resolvedRepo = await resolveRepo(repo, cwd);

      const ghArgs: string[] = ['issue', 'edit', String(issueNum), '--repo', resolvedRepo];
      const fields: string[] = [];
      if (body !== undefined) {
        ghArgs.push('--body', body);
        fields.push('body');
      }
      if (title) {
        ghArgs.push('--title', title);
        fields.push('title');
      }

      await runGh(ghArgs, cwd);

      logDebugEvent('gh_issue_edit.done', { issue: issueNum, fields });
      return formatGhIssueEdited(issueNum, fields);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_issue_edit.error', { error: msg });
      return `Error editing issue: ${msg}`;
    }
  },
});
