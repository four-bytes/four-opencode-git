// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { getGitLabProjectId, gitlabApi } from '../lib/gitlab-utils';
import { logDebugEvent } from '../lib/debug-logger';

export const gitlabMrCreateTool = tool({
  description: 'Create a GitLab merge request. Uses GITLAB_TOKEN for authentication.',

  args: {
    title: tool.schema.string().describe('MR title'),
    sourceBranch: tool.schema.string().describe('Source branch name'),
    targetBranch: tool.schema.string().optional().describe('Target branch (default: main)'),
    description: tool.schema.string().optional().describe('MR description (markdown)'),
  },

  async execute(args, ctx) {
    const { title, sourceBranch, targetBranch, description } = args;

    logDebugEvent('gitlab_mr_create.start', { title, sourceBranch, targetBranch });

    try {
      const projectId = await getGitLabProjectId(ctx.directory);
      if (!projectId) return 'Could not determine GitLab project ID from git remote.';

      const result = await gitlabApi(`projects/${projectId}/merge_requests`, 'POST', {
        title,
        source_branch: sourceBranch,
        target_branch: targetBranch || 'main',
        description: description || '',
      });

      if (!result.ok) {
        return `Failed to create MR: ${result.error}`;
      }

      const mr = result.data;
      logDebugEvent('gitlab_mr_create.success', { iid: mr.iid, url: mr.web_url });
      return `MR !${mr.iid} created: ${mr.title}\n   ${mr.web_url}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gitlab_mr_create.error', { error: msg });
      return `Error: ${msg}`;
    }
  },
});
