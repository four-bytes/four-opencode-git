// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import {
  forgejoApi,
  forgejoApiAll,
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
  /** PRs whose title/body reference the issue; undefined when the lookup failed. */
  linkedPulls?: LinkedPull[];
}

export interface LinkedPull {
  number: number;
  state: string;
  merged: boolean;
}

// ────────────────────────────────────────────────────────────────
// Zombie check (pure)
// ────────────────────────────────────────────────────────────────

/**
 * PRs that reference `#issue` — a closing keyword in the body (`Closes #12`) or
 * `#12` in the title (`feat: x (#12)`). Exported for testing.
 */
export function findLinkedPulls(pulls: unknown, issue: number): LinkedPull[] {
  if (!Array.isArray(pulls)) return [];
  const inBody = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issue}\\b`, 'i');
  const inTitle = new RegExp(`#${issue}\\b`);
  return pulls
    .filter(
      (p: any) =>
        inBody.test(typeof p?.body === 'string' ? p.body : '') ||
        inTitle.test(typeof p?.title === 'string' ? p.title : '')
    )
    .map((p: any) => ({ number: p.number, state: p.state, merged: p.merged === true }));
}

/** One line on how the issue relates to its PRs. Exported for testing. */
export function formatLinkedPulls(issue: number, linked: LinkedPull[] | undefined): string {
  if (linked === undefined) return `⚠ Could not check PRs referencing #${issue}.`;
  const merged = linked.filter((p) => p.merged);
  if (merged.length > 0) {
    return `✓ Referenced by merged PR ${merged.map((p) => `!${p.number}`).join(', ')}.`;
  }
  if (linked.length > 0) {
    const list = linked.map((p) => `!${p.number} (${p.state})`).join(', ');
    return `⚠ No merged PR for #${issue} — referenced by ${list}. Closing as requested.`;
  }
  return `⚠ No PR references #${issue} — closing without a linked merge.`;
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
  if (params.closed) {
    lines.push(`✓ Issue #${params.issue} "${params.title}" closed.`);
    lines.push(formatLinkedPulls(params.issue, params.linkedPulls));
  }
  if (params.closeError) lines.push(`✗ Failed to close issue: ${params.closeError}`);
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoIssueCloseTool = tool({
  description:
    'Close a Forgejo issue, with an optional comment. Reports whether a merged PR references the issue (zombie check). The comment is posted via the REST API as a tool argument — it never passes through a shell.',

  args: {
    issue: tool.schema.number().describe('Issue number (index) to close'),
    comment: tool.schema.string().optional().describe('Optional comment to post before closing'),
  },

  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const comment = args.comment as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forgejo_issue_close.start', { issue: issueNum, hasComment: !!comment });

    try {
      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return cfg.message;
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

      // ── Step 4: Zombie check — which PRs reference this issue ──
      let linkedPulls: LinkedPull[] | undefined;
      if (closeResult.ok) {
        const pulls = await forgejoApiAll(`/repos/${repo}/pulls?state=all&sort=recentupdate`, config, 2);
        linkedPulls = pulls.ok ? findLinkedPulls(pulls.data, issueNum) : undefined;
      }

      const output = formatForgejoIssueClose({
        issue: issueNum,
        title,
        linkedPulls,
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
