// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { runGh } from '../lib/gh-utils';
import { forgejoApi, getForgejoConfig } from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

/**
 * Format a reaction array as counts, in first-occurrence order:
 *
 *   REACTIONS — #12 [github]
 *     +1 ×2   heart ×1
 *     (total 3)
 *
 * Pure — exported for testing.
 */
export function formatReactionList(raw: unknown, issue: number, backend: string): string {
  const header = `REACTIONS — #${issue} [${backend}]`;
  const all = Array.isArray(raw) ? raw : [];
  if (all.length === 0) return `${header} — none`;

  const counts = new Map<string, number>();
  for (const reaction of all) {
    const content = typeof (reaction as any)?.content === 'string' ? (reaction as any).content : 'unknown';
    counts.set(content, (counts.get(content) ?? 0) + 1);
  }

  const summary = [...counts.entries()].map(([content, count]) => `${content} ×${count}`).join('   ');
  return [header, `  ${summary}`, `  (total ${all.length})`].join('\n');
}

/** List reactions on a GitHub issue/PR (repo already resolved). */
async function listGhReactions(repo: string, issueNum: number, cwd: string): Promise<string> {
  const rawJson = await runGh(
    ['api', '--paginate', '--slurp', `repos/${repo}/issues/${issueNum}/reactions?per_page=100`],
    cwd,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return `Error parsing gh api output. Raw output:\n${rawJson}`;
  }
  // --slurp wraps all pages in one outer array; flatten to a single reaction list.
  const raw =
    Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0]) ? (parsed as unknown[][]).flat() : parsed;
  return formatReactionList(raw, issueNum, 'github');
}

/** List reactions on a Forgejo issue/PR (repo already resolved). */
async function listForgejoReactions(repo: string, issueNum: number, cwd: string): Promise<string> {
  const cfg = getForgejoConfig(cwd);
  if (!cfg.ok) return cfg.message;
  const result = await forgejoApi(`/repos/${repo}/issues/${issueNum}/reactions`, cfg.config);
  if (!result.ok) return `Error reading reactions on #${issueNum}: ${result.error}`;
  return formatReactionList(result.data, issueNum, 'forgejo');
}

export const forgeReactionListTool = tool({
  description:
    'List the reactions on an issue or PR of the current repo regardless of forge. Detects GitHub/Forgejo from the origin remote (override with `backend`). Counts per content: `+1 |-1 |laugh |confused |heart |hooray |rocket |eyes`. GitLab award emoji are not supported yet.',
  args: {
    issue: tool.schema.number().describe('Issue or PR number'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const repoArg = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_reaction_list.start', { issue: issueNum });

    try {
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo: repoArg });
      if (!resolved.ok) return resolved.message;
      const { backend, repo } = resolved.ctx;

      logDebugEvent('forge_reaction_list.target', { backend, repo, issue: issueNum });

      if (backend === 'gitlab') return 'GitLab reactions (award emoji) are not supported yet.';
      return backend === 'forgejo'
        ? listForgejoReactions(repo!, issueNum, cwd)
        : listGhReactions(repo!, issueNum, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_reaction_list.error', { error: msg });
      return `Error reading reactions: ${msg}`;
    }
  },
});
