// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { closeGhIssue } from './gh-issue-close';
import { closeForgejoIssue } from './forgejo-issue-close';
import { logDebugEvent } from '../lib/debug-logger';

const REASONS = ['completed', 'not_planned'] as const;

export const forgeIssueCloseTool = tool({
  description:
    'Close an issue on the current repo regardless of forge, with an optional comment. Detects GitHub/Forgejo from the origin remote (override with `backend`). GitHub reports zombie issues (merged PR but issue still open); Forgejo reports whether a merged PR references the issue. GitLab is not supported yet.',
  args: {
    issue: tool.schema.number().describe('Issue number to close'),
    reason: tool.schema
      .enum(REASONS, "Close reason (default: 'completed'); 'not_planned' maps to GitHub's \"not planned\"")
      .optional(),
    comment: tool.schema.string().optional().describe('Optional comment to post before closing'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const issue = args.issue as number;
    const reason = args.reason as (typeof REASONS)[number] | undefined;
    const comment = args.comment as string | undefined;
    const repo = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_issue_close.start', { issue, reason, hasComment: !!comment, repo, backendOverride });

    try {
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo });
      if (!resolved.ok) return resolved.message;
      const { backend, repo: target } = resolved.ctx;

      logDebugEvent('forge_issue_close.target', { backend, repo: target });

      if (backend === 'gitlab') return 'GitLab issue close is not supported yet.';

      if (backend === 'forgejo') {
        const output = await closeForgejoIssue(target!, issue, cwd);
        return `[${backend}] ${output}`;
      }

      // GitHub expects "completed" | "not planned".
      const ghReason = reason === 'not_planned' ? 'not planned' : reason;
      const output = await closeGhIssue(target!, issue, ghReason, comment, cwd);
      return `[${backend}] ${output}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_issue_close.error', { error: msg });
      return `Error closing issue: ${msg}`;
    }
  },
});
