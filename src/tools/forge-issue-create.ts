// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { createGhIssue } from './gh-issue-create';
import { createForgejoIssue } from './forgejo-issue-create';
import { splitLabels } from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

export const forgeIssueCreateTool = tool({
  description:
    'Create an issue on the current repo regardless of forge. Detects GitHub/Forgejo/GitLab from the origin remote (override with `backend`) and dispatches to the matching adapter. Validates labels/assignees first — any unknown value aborts and nothing is created. Title/body are tool arguments (never shell). Returns a compact reference.',
  args: {
    title: tool.schema.string().describe('Issue title, e.g. "[FEAT] one-sentence change"'),
    body: tool.schema.string().optional().describe('Issue body (markdown)'),
    labels: tool.schema.string().optional().describe('Comma-separated label names'),
    assignees: tool.schema.string().optional().describe('Comma-separated logins (GitHub only)'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const title = (args.title as string)?.trim();
    const body = (args.body as string | undefined) ?? '';
    const labels = splitLabels(args.labels as string | undefined);
    const assignees = splitLabels(args.assignees as string | undefined);
    const repo = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_issue_create.start', { labels, assignees, repo, backendOverride });

    try {
      if (!title) return 'Error: title must not be empty.';

      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo });
      if (!resolved.ok) return resolved.message;
      const { backend, repo: target } = resolved.ctx;

      logDebugEvent('forge_issue_create.target', { backend, repo: target });

      if (backend === 'gitlab') {
        return 'GitLab issue creation is not supported yet. Use the GitLab UI or `glab` CLI.';
      }
      if (backend === 'forgejo') {
        const res = await createForgejoIssue(target!, { title, body, labels }, cwd);
        return `[forgejo] ${res.output}`;
      }
      const output = await createGhIssue(target!, { title, body, labels, assignees }, cwd);
      return `[${backend}] ${output}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_issue_create.error', { error: msg });
      return `Error creating issue: ${msg}`;
    }
  },
});
