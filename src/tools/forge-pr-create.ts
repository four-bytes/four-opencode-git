// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { createGhPr } from './gh-pr-create';
import { createForgejoPr } from './forgejo-pr-create';
import { createGitlabMr } from './gitlab-mr-create';
import { logDebugEvent } from '../lib/debug-logger';

export const forgePrCreateTool = tool({
  description:
    'Create a PR (GitHub/Forgejo) or merge request (GitLab) on the current repo regardless of forge. Detects the provider from the origin remote (override with `backend`). `head` maps to GitLab source_branch, `base` to target_branch.',
  args: {
    title: tool.schema.string().describe('PR/MR title'),
    body: tool.schema.string().optional().describe('PR/MR description (markdown)'),
    head: tool.schema.string().optional().describe('Source branch (defaults to current branch)'),
    base: tool.schema.string().optional().describe('Target branch (defaults to repo default branch / main)'),
    draft: tool.schema.boolean().optional().describe('Create as draft (GitHub only)'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const title = (args.title as string)?.trim();
    const body = (args.body as string | undefined) ?? '';
    const head = args.head as string | undefined;
    const base = args.base as string | undefined;
    const draft = args.draft as boolean | undefined;
    const repo = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_pr_create.start', { title, head, base, draft, backendOverride });

    try {
      if (!title) return 'Error: title must not be empty.';
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo });
      if (!resolved.ok) return resolved.message;
      const { backend, repo: target } = resolved.ctx;

      logDebugEvent('forge_pr_create.target', { backend, repo: target });

      const output =
        backend === 'forgejo'
          ? await createForgejoPr(target!, { title, body, head, base }, cwd)
          : backend === 'gitlab'
            ? await createGitlabMr(target!, { title, body, sourceBranch: head, targetBranch: base }, cwd)
            : await createGhPr(target!, { title, body, head, base, draft }, cwd);
      return `[${backend}] ${output}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_pr_create.error', { error: msg });
      return `Error creating PR: ${msg}`;
    }
  },
});
