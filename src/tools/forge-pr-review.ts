// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { getGhPrReview } from './gh-pr-review';
import { logDebugEvent } from '../lib/debug-logger';

export const forgePrReviewTool = tool({
  description:
    "Fetch review comments and reviews on a pull request of the current repo regardless of forge. Detects GitHub/Forgejo from the origin remote (override with `backend`); GitLab is not supported yet. On Forgejo review verdicts and inline comments are bundled into forge_pr_comments — use that instead.",
  args: {
    pr: tool.schema.number().describe('PR number to review'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const pr = args.pr as number;
    const repo = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_pr_review.start', { pr });

    try {
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo });
      if (!resolved.ok) return resolved.message;
      const { backend, repo: target } = resolved.ctx;

      logDebugEvent('forge_pr_review.target', { backend, repo: target });

      if (backend === 'forgejo') {
        return 'Forgejo review verdicts and inline comments are bundled into forge_pr_comments — use that instead.';
      }
      if (backend === 'gitlab') return 'GitLab merge-request reviews are not supported yet.';
      return await getGhPrReview(target!, pr, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_pr_review.error', { error: msg });
      return `Error fetching PR reviews: ${msg}`;
    }
  },
});
