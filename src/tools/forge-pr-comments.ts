// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { getGhPrComments } from './gh-pr-comments';
import { getForgejoPrComments } from './forgejo-pr-comments';
import { logDebugEvent } from '../lib/debug-logger';

export const forgePrCommentsTool = tool({
  description:
    "Read a PR's conversation, review verdicts and inline review comments on the current repo regardless of forge — one line each, time-ordered. Detects GitHub/Forgejo from the origin remote (override with `backend`); GitLab is not supported yet. An open human thread blocks merge; bot findings never do.",
  args: {
    pr: tool.schema.number().describe('PR number'),
    limit: tool.schema.number().optional().describe('How many of the most recent entries to show (default: 20)'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const pr = args.pr as number;
    const limit = Math.max(1, (args.limit as number | undefined) ?? 20);
    const repo = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_pr_comments.start', { pr, limit });

    try {
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo });
      if (!resolved.ok) return resolved.message;
      const { backend, repo: target } = resolved.ctx;

      logDebugEvent('forge_pr_comments.target', { backend, repo: target });

      if (backend === 'gitlab') return 'GitLab merge-request comments are not supported yet.';
      return backend === 'forgejo'
        ? await getForgejoPrComments(target!, pr, limit, cwd)
        : await getGhPrComments(target!, pr, limit, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_pr_comments.error', { error: msg });
      return `Error reading PR comments: ${msg}`;
    }
  },
});
