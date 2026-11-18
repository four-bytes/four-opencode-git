// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { getGhPrStatus } from './gh-pr-status';
import { getForgejoPrStatus } from './forgejo-pr-status';
import { getGitlabMrStatus } from './gitlab-mr-status';
import { logDebugEvent } from '../lib/debug-logger';

export const forgePrStatusTool = tool({
  description:
    'Check mergeability of a PR (GitHub/Forgejo) or merge request (GitLab) on the current repo regardless of forge. Detects the provider from the origin remote (override with `backend`).',
  args: {
    pr: tool.schema.number().describe('PR or MR number (!N for GitLab)'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const pr = args.pr as number;
    const repo = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_pr_status.start', { pr });

    try {
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo });
      if (!resolved.ok) return resolved.message;
      const { backend, repo: target } = resolved.ctx;

      logDebugEvent('forge_pr_status.target', { backend, repo: target });

      const output =
        backend === 'forgejo'
          ? await getForgejoPrStatus(target!, pr, cwd)
          : backend === 'gitlab'
            ? await getGitlabMrStatus(target!, pr, cwd)
            : await getGhPrStatus(target!, pr, cwd);
      return output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_pr_status.error', { error: msg });
      return `Error checking PR: ${msg}`;
    }
  },
});
