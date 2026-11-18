// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { mergeGhPr } from './gh-pr-merge';
import { mergeForgejoPr } from './forgejo-pr-merge';
import { logDebugEvent } from '../lib/debug-logger';

const METHODS = ['squash', 'merge', 'rebase', 'rebase-merge', 'fast-forward-only'] as const;

export const forgePrMergeTool = tool({
  description:
    'Merge a PR on the current repo regardless of forge (default: squash + delete branch). Detects GitHub/Forgejo from the origin remote (override with `backend`); GitLab is not supported yet. Refuses when the PR is not open, conflicting, blocked, or has an open human review thread. GitHub supports only squash, merge or rebase.',
  args: {
    pr: tool.schema.number().describe('PR number to merge'),
    method: tool.schema.enum(METHODS, 'Merge style (default: squash)').optional(),
    title: tool.schema.string().optional().describe('Merge commit subject (default: PR title)'),
    message: tool.schema.string().optional().describe('Merge commit body (default: PR body, keeps "Closes #N")'),
    delete_branch: tool.schema.boolean().optional().describe('Delete the head branch after merging (default: true)'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const pr = args.pr as number;
    const method = args.method as string | undefined;
    const title = args.title as string | undefined;
    const message = args.message as string | undefined;
    const deleteBranch = (args.delete_branch as boolean | undefined) ?? true;
    const repo = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_pr_merge.start', { pr, method, deleteBranch });

    try {
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo });
      if (!resolved.ok) return resolved.message;
      const { backend, repo: target } = resolved.ctx;

      logDebugEvent('forge_pr_merge.target', { backend, repo: target });

      if (backend === 'gitlab') return 'GitLab merge-request merge is not supported yet.';

      if (backend === 'github') {
        if (method === 'rebase-merge' || method === 'fast-forward-only') {
          return `Merge method "${method}" is not supported by GitHub — use squash, merge, or rebase.`;
        }
        const output = await mergeGhPr(
          target!,
          pr,
          method ?? 'squash',
          title,
          message,
          deleteBranch,
          cwd
        );
        return `[${backend}] ${output}`;
      }

      const output = await mergeForgejoPr(
        target!,
        pr,
        method ?? 'squash',
        title,
        message,
        deleteBranch,
        cwd
      );
      return `[${backend}] ${output}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_pr_merge.error', { error: msg });
      return `Error merging PR: ${msg}`;
    }
  },
});
