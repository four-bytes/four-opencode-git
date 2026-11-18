// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Core — reusable, takes an already-resolved repo
// ────────────────────────────────────────────────────────────────

export interface GhPrCreateInput {
  title: string;
  body: string;
  head?: string;
  base?: string;
  draft?: boolean;
}

/** Create a GitHub PR via `gh pr create`. Returns the formatted output. */
export async function createGhPr(
  repo: string,
  input: GhPrCreateInput,
  cwd: string
): Promise<string> {
  const repoArgs = ['-R', repo];

  const ghArgs = ['pr', 'create', ...repoArgs, '--title', input.title];
  if (input.body) ghArgs.push('--body', input.body);
  if (input.base) ghArgs.push('--base', input.base);
  if (input.head) ghArgs.push('--head', input.head);
  if (input.draft) ghArgs.push('--draft');

  const output = await runGh(ghArgs, cwd);
  // gh pr create outputs the PR URL on success
  return `✅ PR created: ${output.trim()}`;
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

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
      const output = await createGhPr(
        resolvedRepo,
        { title, body: body ?? '', head, base, draft },
        ctx.directory
      );
      logDebugEvent('gh_pr_create.success', { title });
      return output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_pr_create.error', { error: msg });
      return `Error creating PR: ${msg}`;
    }
  },
});
