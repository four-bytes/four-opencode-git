// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { forgejoApi, getForgejoConfig } from '../lib/forgejo-utils';
import { gitlabApi } from '../lib/gitlab-utils';
import { isValidColor } from '../lib/forge-labels';
import { runGh } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

export const forgeLabelCreateTool = tool({
  description:
    'Create a label on the current repo regardless of forge. Detects GitHub/Forgejo/GitLab from the origin remote (override with `backend`). `color` is six hex digits without "#" (e.g. "ff0000").',
  args: {
    name: tool.schema.string().describe('Label name'),
    color: tool.schema.string().describe('Label color: six hex digits without "#", e.g. "ff0000"'),
    description: tool.schema.string().optional().describe('Label description'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const name = (args.name as string)?.trim();
    const color = (args.color as string)?.trim().replace(/^#/, '');
    const description = args.description as string | undefined;
    const repoArg = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_label_create.start', { name, color, repo: repoArg, backendOverride });

    try {
      if (!name) return 'Error: name must not be empty.';
      if (!isValidColor(color)) {
        return `Error: Invalid color "${args.color}". Expected six hex digits without "#" (e.g. "ff0000").`;
      }

      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo: repoArg });
      if (!resolved.ok) return resolved.message;
      const { backend, repo } = resolved.ctx;

      logDebugEvent('forge_label_create.target', { backend, repo });

      const payload: Record<string, unknown> = { name, color };
      if (description) payload.description = description;

      if (backend === 'github') {
        const ghArgs = ['api', `repos/${repo}/labels`, '-f', `name=${name}`, '-f', `color=${color}`];
        if (description) ghArgs.push('-f', `description=${description}`);
        await runGh(ghArgs, cwd);
      } else if (backend === 'forgejo') {
        const cfg = getForgejoConfig(cwd);
        if (!cfg.ok) return cfg.message;
        const result = await forgejoApi(`/repos/${repo}/labels`, cfg.config, {
          method: 'POST',
          body: payload,
        });
        if (!result.ok) return `Error creating label: ${result.error}`;
      } else {
        const result = await gitlabApi(`projects/${repo}/labels`, 'POST', payload);
        if (!result.ok) return `Error creating label: ${result.error}`;
      }

      return `✓ Created label "${name}" (#${color}) in ${repo}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_label_create.error', { error: msg });
      return `Error creating label: ${msg}`;
    }
  },
});
