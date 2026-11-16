// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { forgejoApiAll, getForgejoConfig } from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface ForgejoRepoListItem {
  full_name: string;
  description: string;
  private: boolean;
  archived: boolean;
  updated_at?: string;
}

// ────────────────────────────────────────────────────────────────
// Normalization
// ────────────────────────────────────────────────────────────────

/**
 * Map raw Forgejo API repository objects to the normalized shape.
 * Exported for testing with fixture JSON.
 */
export function normalizeForgejoRepoList(raw: unknown): ForgejoRepoListItem[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((repo: any) => ({
    full_name: String(repo?.full_name ?? ''),
    description: typeof repo?.description === 'string' ? repo.description : '',
    private: repo?.private === true,
    archived: repo?.archived === true,
    updated_at: repo?.updated_at,
  }));
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

/**
 * Pure formatter — one line per repository, `owner/name [private] [archived]`.
 * Exported for testing without a repo or API.
 */
export function formatForgejoRepoList(repos: ForgejoRepoListItem[], scope: string): string {
  if (repos.length === 0) {
    return `FORGEJO REPO LIST — ${scope} — no repositories found.`;
  }

  const lines: string[] = [];
  lines.push(
    `FORGEJO REPO LIST — ${scope} — ${repos.length} repositor${repos.length !== 1 ? 'ies' : 'y'}`
  );
  lines.push('');

  for (const repo of repos) {
    const visibility = repo.private ? 'private' : 'public';
    const archived = repo.archived ? ' [archived]' : '';
    const description = repo.description.replace(/\s+/g, ' ').trim();
    const descriptionPart = description ? ` — ${description}` : '';
    lines.push(`  ${repo.full_name} [${visibility}]${archived}${descriptionPart}`);
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoRepoListTool = tool({
  description:
    'List Forgejo repositories via the REST API, one line per repo. Lists the authenticated user\'s repositories by default; `org` lists that org instead.',

  args: {
    org: tool.schema
      .string()
      .optional()
      .describe('Organization whose repositories to list instead of the authenticated user\'s'),
    limit: tool.schema.number().describe('Maximum number of repositories to return (default: 20)'),
  },

  async execute(args, ctx) {
    const org = (args.org as string | undefined)?.trim() || undefined;
    const limit = (args.limit as number) ?? 20;
    const cwd = ctx.directory;

    logDebugEvent('forgejo_repo_list.start', { org, limit });

    try {
      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return cfg.message;

      const path = org ? `/orgs/${org}/repos` : '/user/repos';
      const result = await forgejoApiAll(path, cfg.config);
      if (!result.ok) return `Failed to list repositories: ${result.error}`;

      const repos = normalizeForgejoRepoList(result.data).slice(0, Math.max(0, limit));
      const scope = org ? `org ${org}` : 'user';

      logDebugEvent('forgejo_repo_list.done', { count: repos.length });
      return formatForgejoRepoList(repos, scope);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_repo_list.error', { error: msg });
      return `Error listing repositories: ${msg}`;
    }
  },
});
