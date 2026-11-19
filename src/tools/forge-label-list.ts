// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { getForgejoConfig } from '../lib/forgejo-utils';
import {
  formatLabelList,
  listForgejoLabels,
  listGithubLabels,
  listGitlabLabels,
  type Label,
} from '../lib/forge-labels';
import { logDebugEvent } from '../lib/debug-logger';

export const forgeLabelListTool = tool({
  description:
    'List the labels of the current repo regardless of forge. Detects GitHub/Forgejo/GitLab from the origin remote (override with `backend`) and prints each label normalized to `name  #color  description`.',
  args: {
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const repoArg = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_label_list.start', { repo: repoArg, backendOverride });

    try {
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo: repoArg });
      if (!resolved.ok) return resolved.message;
      const { backend, repo } = resolved.ctx;

      logDebugEvent('forge_label_list.target', { backend, repo });

      let labels: Label[];
      if (backend === 'github') {
        const listed = await listGithubLabels(repo!, cwd);
        if (!listed.ok) return `Error listing labels: ${listed.error}`;
        labels = listed.labels;
      } else if (backend === 'forgejo') {
        const cfg = getForgejoConfig(cwd);
        if (!cfg.ok) return cfg.message;
        const listed = await listForgejoLabels(repo!, cfg.config);
        if (!listed.ok) return `Error listing labels: ${listed.error}`;
        labels = listed.labels;
      } else {
        const listed = await listGitlabLabels(repo!);
        if (!listed.ok) return `Error listing labels: ${listed.error}`;
        labels = listed.labels;
      }

      return formatLabelList(repo!, backend, labels);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_label_list.error', { error: msg });
      return `Error listing labels: ${msg}`;
    }
  },
});
