// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import {
  forgejoApi,
  forgejoConfigMessage,
  getForgejoConfig,
  getForgejoRepo,
} from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface ForgejoCloseResult {
  issue: number;
  title: string;
  alreadyClosed: boolean;
  commentPosted: boolean;
  closed: boolean;
  commentError?: string;
  closeError?: string;
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

/** Pure formatter — exported for testing without a repo or API. */
function formatForgejoIssueClose(params: ForgejoCloseResult): string {
  if (params.alreadyClosed) {
    return `Issue #${params.issue} "${params.title}" is already closed. Nothing to do.`;
  }

  const lines: string[] = [];
  if (params.commentPosted) lines.push(`✓ Comment posted on #${params.issue}`);
  if (params.commentError) lines.push(`⚠ Failed to post comment: ${params.commentError}`);
  if (params.closed) lines.push(`✓ Issue #${params.issue} "${params.title}" closed.`);
  if (params.closeError) lines.push(`✗ Failed to close issue: ${params.closeError}`);
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoIssueCloseTool = tool({
  description:
    'Close a Forgejo issue, with an optional comment. The comment is posted via the REST API as a tool argument — it never passes through a shell. Forgejo state queries go through this tool — fj has no --json.',

  args: {
    issue: tool.schema.number().describe('Issue number (index) to close'),
    comment: tool.schema.string().describe('Optional comment to post before closing'),
  },

  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const comment = args.comment as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forgejo_issue_close.start', { issue: issueNum, hasComment: !!comment });

    try {
      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return forgejoConfigMessage(cfg.reason);
      const config = cfg.config;

      const repo = await getForgejoRepo(cwd);
      if (!repo) return 'Could not determine Forgejo repository from origin remote.';

      // ── Step 1: Check if issue is already closed ──
      const viewResult = await forgejoApi(`/repos/${repo}/issues/${issueNum}`, config);
      if (!viewResult.ok) {
        return `Error viewing issue #${issueNum}: ${viewResult.error}`;
      }

      const issue = viewResult.data as { title?: string; state?: string };
      const title = issue.title ?? '';
      const state = issue.state ?? '';

      if (state === 'closed') {
        const output = formatForgejoIssueClose({
          issue: issueNum,
          title,
          alreadyClosed: true,
          commentPosted: false,
          closed: false,
        });
        logDebugEvent('forgejo_issue_close.done', { issue: issueNum, alreadyClosed: true });
        return output;
      }

      // ── Step 2: Post optional comment ──
      let commentPosted = false;
      let commentError: string | undefined;
      if (comment) {
        const commentResult = await forgejoApi(
          `/repos/${repo}/issues/${issueNum}/comments`,
          config,
          { method: 'POST', body: { body: comment } }
        );
        if (commentResult.ok) {
          commentPosted = true;
        } else {
          commentError = commentResult.error;
        }
      }

      // ── Step 3: Close the issue ──
      const closeResult = await forgejoApi(`/repos/${repo}/issues/${issueNum}`, config, {
        method: 'PATCH',
        body: { state: 'closed' },
      });

      const output = formatForgejoIssueClose({
        issue: issueNum,
        title,
        alreadyClosed: false,
        commentPosted,
        closed: closeResult.ok,
        commentError,
        closeError: closeResult.ok ? undefined : closeResult.error,
      });

      logDebugEvent('forgejo_issue_close.done', { issue: issueNum, closed: closeResult.ok });
      return output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_issue_close.error', { error: msg });
      return `Error closing issue: ${msg}`;
    }
  },
});

export { formatForgejoIssueClose };
