// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { runGh } from '../lib/gh-utils';
import { forgejoApi, getForgejoConfig } from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

/** Canonical reaction content set — identical for GitHub and Forgejo. */
export const REACTION_CONTENTS = ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'] as const;

export type ReactionContent = (typeof REACTION_CONTENTS)[number];

/** Pure: is `content` one of the canonical reaction values? Exported for testing. */
export function isValidReactionContent(content: string): content is ReactionContent {
  return (REACTION_CONTENTS as readonly string[]).includes(content);
}

/** Add a reaction to a GitHub issue/PR (repo already resolved). */
async function addGhReaction(repo: string, issueNum: number, content: string, cwd: string): Promise<string> {
  await runGh(['api', `repos/${repo}/issues/${issueNum}/reactions`, '-f', `content=${content}`], cwd);
  return `✓ Reacted ${content} on #${issueNum}`;
}

/** Add a reaction to a Forgejo issue/PR (repo already resolved). */
async function addForgejoReaction(repo: string, issueNum: number, content: string, cwd: string): Promise<string> {
  const cfg = getForgejoConfig(cwd);
  if (!cfg.ok) return cfg.message;
  const result = await forgejoApi(`/repos/${repo}/issues/${issueNum}/reactions`, cfg.config, {
    method: 'POST',
    body: { content },
  });
  if (!result.ok) return `Error reacting to #${issueNum}: ${result.error}`;
  return `✓ Reacted ${content} on #${issueNum}`;
}

export const forgeReactionAddTool = tool({
  description:
    'Add a reaction to an issue or PR of the current repo regardless of forge. Detects GitHub/Forgejo from the origin remote (override with `backend`). Content set is identical on GitHub and Forgejo: `+1 |-1 |laugh |confused |heart |hooray |rocket |eyes`. GitLab award emoji are not supported yet.',
  args: {
    issue: tool.schema.number().describe('Issue or PR number'),
    content: tool.schema
      .enum(['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'])
      .describe('Reaction content'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const content = (args.content as string) ?? '';
    const repoArg = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_reaction_add.start', { issue: issueNum, content });

    try {
      if (!isValidReactionContent(content)) {
        return `Error: invalid reaction content "${content}". Valid values: ${REACTION_CONTENTS.join(', ')}.`;
      }

      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo: repoArg });
      if (!resolved.ok) return resolved.message;
      const { backend, repo } = resolved.ctx;

      logDebugEvent('forge_reaction_add.target', { backend, repo, issue: issueNum });

      if (backend === 'gitlab') return 'GitLab reactions (award emoji) are not supported yet.';
      return backend === 'forgejo'
        ? addForgejoReaction(repo!, issueNum, content, cwd)
        : addGhReaction(repo!, issueNum, content, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_reaction_add.error', { error: msg });
      return `Error adding reaction: ${msg}`;
    }
  },
});
