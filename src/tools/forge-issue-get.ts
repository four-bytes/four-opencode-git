// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { getGhIssue } from './gh-issue-view';
import { getForgejoIssue } from './forgejo-issue-view';
import { logDebugEvent } from '../lib/debug-logger';

export const forgeIssueGetTool = tool({
  description:
    'Read one issue on the current repo regardless of forge. Detects GitHub/Forgejo/GitLab from the origin remote (override with `backend`). Returns number, title, state, labels, full body, comment count.',
  args: {
    issue: tool.schema.number().describe('Issue number'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const repo = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_issue_get.start', { issue: issueNum });

    try {
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo });
      if (!resolved.ok) return resolved.message;
      const { backend, repo: target } = resolved.ctx;

      logDebugEvent('forge_issue_get.target', { backend, repo: target });

      if (backend === 'gitlab') return 'GitLab issue view is not supported yet.';
      return backend === 'forgejo'
        ? getForgejoIssue(target!, issueNum, cwd)
        : getGhIssue(target!, issueNum, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_issue_get.error', { error: msg });
      return `Error viewing issue: ${msg}`;
    }
  },
});
