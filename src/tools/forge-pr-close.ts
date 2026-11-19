// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { closeGhPr } from './gh-pr-close';
import { closeForgejoPr } from './forgejo-pr-close';
import { logDebugEvent } from '../lib/debug-logger';

export const forgePrCloseTool = tool({
  description:
    'Close a PR on the current repo regardless of forge WITHOUT merging (abandoned work), with an optional comment explaining why. The comment is a tool argument — no shell. Detects GitHub/Forgejo from the origin remote (override with `backend`); GitLab is not supported yet. To merge, use forge_pr_merge.',
  args: {
    pr: tool.schema.number().describe('PR number to close'),
    comment: tool.schema.string().optional().describe('Optional comment to post before closing'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const pr = args.pr as number;
    const comment = args.comment as string | undefined;
    const repo = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_pr_close.start', { pr, hasComment: !!comment });

    try {
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo });
      if (!resolved.ok) return resolved.message;
      const { backend, repo: target } = resolved.ctx;

      logDebugEvent('forge_pr_close.target', { backend, repo: target });

      if (backend === 'gitlab') return 'GitLab merge-request close is not supported yet.';
      return backend === 'forgejo'
        ? await closeForgejoPr(target!, pr, comment, cwd)
        : await closeGhPr(target!, pr, comment, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_pr_close.error', { error: msg });
      return `Error closing PR: ${msg}`;
    }
  },
});
