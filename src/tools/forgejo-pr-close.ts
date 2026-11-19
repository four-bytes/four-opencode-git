// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { forgejoApi, getForgejoConfig, getForgejoRepo } from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Core — reusable, takes an already-resolved repo
// ────────────────────────────────────────────────────────────────

/** Close a Forgejo PR via the API, optionally commenting first. */
export async function closeForgejoPr(
  repo: string,
  prNum: number,
  comment: string | undefined,
  cwd: string
): Promise<string> {
  const cfg = getForgejoConfig(cwd);
  if (!cfg.ok) return cfg.message;
  const config = cfg.config;

  const view = await forgejoApi(`/repos/${repo}/pulls/${prNum}`, config);
  if (!view.ok) return `Failed to get PR !${prNum}: ${view.error}`;
  if (view.data?.merged === true) return `PR !${prNum} is already merged. Nothing to close.`;
  if (view.data?.state === 'closed') return `PR !${prNum} is already closed. Nothing to do.`;

  const lines: string[] = [];
  if (comment?.trim()) {
    const posted = await forgejoApi(`/repos/${repo}/issues/${prNum}/comments`, config, {
      method: 'POST',
      body: { body: comment },
    });
    lines.push(posted.ok ? `✓ Comment posted on !${prNum}` : `⚠ Failed to post comment: ${posted.error}`);
  }

  const closed = await forgejoApi(`/repos/${repo}/pulls/${prNum}`, config, {
    method: 'PATCH',
    body: { state: 'closed' },
  });
  lines.push(
    closed.ok
      ? `✓ PR !${prNum} "${view.data?.title ?? ''}" closed without merging. Branch ${view.data?.head?.ref} kept.`
      : `✗ Failed to close PR !${prNum}: ${closed.error}`
  );

  logDebugEvent('forgejo_pr_close.done', { pr: prNum, closed: closed.ok });
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoPrCloseTool = tool({
  description:
    'Close a Forgejo pull request WITHOUT merging (abandoned work), with an optional comment explaining why. The comment is a tool argument — no shell. To merge, use forgejo_pr_merge.',

  args: {
    pr: tool.schema.number().describe('PR number to close'),
    comment: tool.schema.string().optional().describe('Optional comment to post before closing'),
  },

  async execute(args, ctx) {
    const n = args.pr as number;
    const comment = args.comment as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forgejo_pr_close.start', { pr: n, hasComment: !!comment });

    try {
      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return cfg.message;

      const repo = await getForgejoRepo(cwd);
      if (!repo) return 'Could not determine Forgejo repository from origin remote.';

      return await closeForgejoPr(repo, n, comment, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_pr_close.error', { error: msg });
      return `Error closing PR: ${msg}`;
    }
  },
});
