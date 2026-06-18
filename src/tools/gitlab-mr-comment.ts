// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { getGitLabProjectId, gitlabApi } from '../lib/gitlab-utils';
import { logDebugEvent } from '../lib/debug-logger';

export const gitlabMrCommentTool = tool({
  description: 'Add a comment to a GitLab merge request.',

  args: {
    mrIid: tool.schema.number().describe('MR internal ID (!number)'),
    body: tool.schema.string().describe('Comment text (markdown)'),
  },

  async execute(args, ctx) {
    const { mrIid, body } = args;

    logDebugEvent('gitlab_mr_comment.start', { mrIid });

    try {
      const projectId = await getGitLabProjectId(ctx.directory);
      if (!projectId) return 'Could not determine GitLab project ID.';

      const result = await gitlabApi(
        `projects/${projectId}/merge_requests/${mrIid}/notes`,
        'POST',
        { body }
      );

      if (!result.ok) {
        return `Failed to add comment: ${result.error}`;
      }

      logDebugEvent('gitlab_mr_comment.success', { mrIid });
      return `Comment added to MR !${mrIid}.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: ${msg}`;
    }
  },
});
