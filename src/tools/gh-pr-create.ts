// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

export const ghPrCreateTool = tool({
  description: 'Create a GitHub pull request. Saves ~90% tokens vs. bash→read→parse.',

  args: {
    title: tool.schema.string().describe('PR title'),
    body: tool.schema.string().optional().describe('PR description'),
    base: tool.schema.string().optional().describe('Target branch (default: main)'),
    head: tool.schema.string().optional().describe('Source branch (default: current branch)'),
    draft: tool.schema.boolean().optional().describe('Create as draft PR'),
    repo: tool.schema
      .string()
      .optional()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
  },

  async execute(args, ctx) {
    const { title, body, base, head, draft, repo } = args;

    logDebugEvent('gh_pr_create.start', { title, base, head, draft });

    try {
      const resolvedRepo = await resolveRepo(repo, ctx.directory);
      const repoArgs = ['-R', resolvedRepo];

      const ghArgs = ['pr', 'create', ...repoArgs, '--title', title];
      if (body) ghArgs.push('--body', body);
      if (base) ghArgs.push('--base', base);
      if (head) ghArgs.push('--head', head);
      if (draft) ghArgs.push('--draft');

      const output = await runGh(ghArgs, ctx.directory);
      // gh pr create outputs the PR URL on success
      logDebugEvent('gh_pr_create.success', { title });
      return `✅ PR created: ${output.trim()}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_pr_create.error', { error: msg });
      return `Error creating PR: ${msg}`;
    }
  },
});
