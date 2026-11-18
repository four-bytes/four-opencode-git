// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { forgejoApi, getForgejoConfig, getForgejoRepo } from '../lib/forgejo-utils';
import { runGit } from '../lib/git-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Core — reusable, takes an already-resolved repo
// ────────────────────────────────────────────────────────────────

export interface ForgejoPrCreateInput {
  title: string;
  body: string;
  head?: string;
  base?: string;
}

/** Create a Forgejo PR after resolving the head/base defaults. Never retries the POST. */
export async function createForgejoPr(
  repo: string,
  input: ForgejoPrCreateInput,
  cwd: string
): Promise<string> {
  const cfg = getForgejoConfig(cwd);
  if (!cfg.ok) return cfg.message;
  const config = cfg.config;

  let head = input.head?.trim();
  if (!head) {
    head = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim();
    if (!head || head === 'HEAD') return 'Error: detached HEAD — pass `head` explicitly.';
  }

  let base = input.base?.trim();
  if (!base) {
    const info = await forgejoApi(`/repos/${repo}`, config);
    if (!info.ok) return `Error reading repository: ${info.error}`;
    base = info.data?.default_branch || 'main';
  }
  if (head === base) return `Error: head and base are both "${head}".`;

  const result = await forgejoApi(`/repos/${repo}/pulls`, config, {
    method: 'POST',
    body: { title: input.title, body: input.body, head, base },
  });
  if (!result.ok) {
    // 409: a PR for this head/base pair already exists.
    const hint = result.status === 409 ? ' (a PR for this branch already exists?)' : '';
    return `Error creating PR: ${result.error}${hint}`;
  }

  logDebugEvent('forgejo_pr_create.done', { pr: result.data?.number });
  return `✓ Created PR !${result.data?.number} ${head} → ${base}: ${input.title}\n  ${result.data?.html_url ?? ''}`.trimEnd();
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoPrCreateTool = tool({
  description:
    'Create a Forgejo pull request. `head` defaults to the current branch, `base` to the repo default branch. Push the branch first (git). Put "Closes #N" in the body so the issue closes on merge. Replaces `fj pr create`.',

  args: {
    title: tool.schema.string().describe('PR title, e.g. "feat: short desc (#12)"'),
    body: tool.schema.string().optional().describe('PR body (markdown), e.g. "Closes #12"'),
    head: tool.schema.string().optional().describe('Source branch (default: current branch)'),
    base: tool.schema.string().optional().describe('Target branch (default: repo default branch)'),
  },

  async execute(args, ctx) {
    const title = (args.title as string)?.trim();
    const body = (args.body as string | undefined) ?? '';
    const cwd = ctx.directory;

    logDebugEvent('forgejo_pr_create.start', { head: args.head, base: args.base });

    try {
      if (!title) return 'Error: title must not be empty.';

      const repo = await getForgejoRepo(cwd);
      if (!repo) return 'Could not determine Forgejo repository from origin remote.';

      return await createForgejoPr(
        repo,
        {
          title,
          body,
          head: args.head as string | undefined,
          base: args.base as string | undefined,
        },
        cwd
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_pr_create.error', { error: msg });
      return `Error creating PR: ${msg}`;
    }
  },
});
