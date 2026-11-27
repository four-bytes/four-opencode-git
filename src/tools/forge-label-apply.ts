// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { forgejoApi, splitLabels } from '../lib/forgejo-utils';
import { getGitLabConfig, gitlabApi } from '../lib/gitlab-utils';
import { prepareLabels } from '../lib/forge-labels';
import { runGh } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

export const forgeLabelApplyTool = tool({
  description:
    'Add labels to an issue or PR on the current repo regardless of forge. Detects GitHub/Forgejo/GitLab from the origin remote (override with `backend`). For GitHub and Forgejo the `issue` arg accepts an issue OR PR number (shared number space); for GitLab it applies to issues only (MR labels not yet supported). Label names are validated first — any unknown label aborts and nothing is applied.',
  args: {
    issue: tool.schema.number().describe('Issue or PR number'),
    labels: tool.schema.string().describe('Comma-separated label names, e.g. "bug,agent-code"'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const issue = args.issue as number;
    const names = splitLabels(args.labels as string | undefined);
    const repoArg = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_label_apply.start', { issue, labels: names, repo: repoArg, backendOverride });

    try {
      if (names.length === 0) return 'Error: labels must not be empty.';

      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo: repoArg });
      if (!resolved.ok) return resolved.message;
      const { backend, repo } = resolved.ctx;

      logDebugEvent('forge_label_apply.target', { backend, repo });

      const prepared = await prepareLabels(backend, repo!, names, cwd);
      if (!prepared.ok) return prepared.message!;

      if (backend === 'github') {
        const ghArgs = ['api', `repos/${repo}/issues/${issue}/labels`];
        for (const label of names) ghArgs.push('-f', `labels[]=${label}`);
        await runGh(ghArgs, cwd);
      } else if (backend === 'forgejo') {
        const result = await forgejoApi(`/repos/${repo}/issues/${issue}/labels`, prepared.config!, {
          method: 'POST',
          body: { labels: prepared.ids },
        });
        if (!result.ok) return `Error applying labels: ${result.error}`;
      } else {
        const cfg = getGitLabConfig(cwd);
        if (!cfg.ok) return cfg.message;
        const result = await gitlabApi(`projects/${repo}/issues/${issue}`, cfg.config, {
          method: 'PUT',
          body: { add_labels: names.join(',') },
        });
        if (!result.ok) return `Error applying labels: ${result.error}`;
      }

      return `✓ Applied labels [${names.join(', ')}] to #${issue}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_label_apply.error', { error: msg });
      return `Error applying labels: ${msg}`;
    }
  },
});
