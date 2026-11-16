// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { forgejoApi, getForgejoConfig, getForgejoRepo } from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Target resolution
// ────────────────────────────────────────────────────────────────

/**
 * Resolve the target repo: an explicit `owner/repo` argument wins, otherwise the
 * current repo from the origin remote. Returns `owner/repo` on success or a
 * message starting with `Error:` — pure, exported for testing.
 */
export function resolveRepoArg(
  repo: string | undefined | null,
  current: string | null | undefined
): string {
  const explicit = repo?.trim();
  if (explicit) {
    const parts = explicit.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return `Error: invalid repo "${explicit}" — expected owner/repo.`;
    }
    return explicit;
  }

  const fromOrigin = current?.trim();
  if (fromOrigin && fromOrigin.includes('/')) return fromOrigin;

  return 'Error: could not determine repository — pass repo="owner/repo".';
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoRepoArchiveTool = tool({
  description:
    'Set or clear a Forgejo repository\'s archived flag. Defaults to the current repo from the origin remote and archives it; `archived=false` unarchives.',

  args: {
    repo: tool.schema
      .string()
      .optional()
      .describe('Target repository as owner/repo (default: the origin remote\'s repo)'),
    archived: tool.schema
      .boolean()
      .describe('true archives the repository, false unarchives it (default: true)'),
  },

  async execute(args, ctx) {
    const repoArg = args.repo as string | undefined;
    const archived = (args.archived as boolean | undefined) ?? true;
    const cwd = ctx.directory;

    logDebugEvent('forgejo_repo_archive.start', { repo: repoArg, archived });

    try {
      const current = repoArg?.trim() ? null : await getForgejoRepo(cwd);
      const target = resolveRepoArg(repoArg, current);
      if (target.startsWith('Error:')) return target;

      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return cfg.message;

      const result = await forgejoApi(`/repos/${target}`, cfg.config, {
        method: 'PATCH',
        body: { archived },
      });
      if (result.status === 404) return `Error: repository ${target} not found.`;
      if (!result.ok) return `Error updating repository ${target}: ${result.error}`;

      logDebugEvent('forgejo_repo_archive.done', { repo: target, archived });
      return `${archived ? 'archived' : 'unarchived'} ${target}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_repo_archive.error', { error: msg });
      return `Error updating repository: ${msg}`;
    }
  },
});
