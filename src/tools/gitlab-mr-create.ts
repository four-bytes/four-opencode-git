// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { getGitLabConfig, getGitLabProjectId, gitlabApi } from '../lib/gitlab-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Core — reusable, takes an already-resolved project id
// ────────────────────────────────────────────────────────────────

export interface GitlabMrCreateInput {
  title: string;
  body: string;
  sourceBranch?: string;
  targetBranch?: string;
}

/** Create a GitLab MR via the REST API. `projectId` is the url-encoded group/project. */
export async function createGitlabMr(
  projectId: string,
  input: GitlabMrCreateInput,
  cwd: string
): Promise<string> {
  if (!input.sourceBranch) {
    return 'Error: source_branch (head) is required for GitLab MR creation.';
  }

  const cfg = getGitLabConfig(cwd);
  if (!cfg.ok) return cfg.message;

  const result = await gitlabApi(
    `projects/${projectId}/merge_requests`,
    cfg.config,
    {
      method: 'POST',
      body: {
        title: input.title,
        source_branch: input.sourceBranch,
        target_branch: input.targetBranch || 'main',
        description: input.body,
      },
    }
  );

  if (!result.ok) {
    return `Failed to create MR: ${result.error}`;
  }

  const mr = result.data;
  logDebugEvent('gitlab_mr_create.success', { iid: mr.iid, url: mr.web_url });
  return `MR !${mr.iid} created: ${mr.title}\n   ${mr.web_url}`;
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const gitlabMrCreateTool = tool({
  description:
    'Create a GitLab merge request. Authentication comes from GITLAB_HOST_<NAME> + GITLAB_TOKEN_<NAME> in ~/.config/four-git/secrets.env (or the environment).',

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

      return await createGitlabMr(
        projectId,
        {
          title,
          body: description || '',
          sourceBranch,
          targetBranch,
        },
        ctx.directory
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gitlab_mr_create.error', { error: msg });
      return `Error: ${msg}`;
    }
  },
});
