// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { getGitLabProjectId, gitlabApi } from '../lib/gitlab-utils';
import { logDebugEvent } from '../lib/debug-logger';

export const gitlabMrStatusTool = tool({
  description: 'Check GitLab merge request status — state, mergeability, approvals, CI pipeline.',

  args: {
    mrIid: tool.schema
      .number()
      .optional()
      .describe('MR internal ID (!number). If omitted, lists all open MRs for the project.'),
  },

  async execute(args, ctx) {
    const { mrIid } = args;

    logDebugEvent('gitlab_mr_status.start', { mrIid });

    try {
      const projectId = await getGitLabProjectId(ctx.directory);
      if (!projectId) return 'Could not determine GitLab project ID.';

      if (mrIid) {
        // Single MR
        const result = await gitlabApi(`projects/${projectId}/merge_requests/${mrIid}`);

        if (!result.ok) return `Failed to get MR: ${result.error}`;

        const mr = result.data;
        const lines = [
          `MR !${mr.iid}: ${mr.title}`,
          `  State:     ${mr.state}`,
          `  Mergeable: ${mr.merge_status}`,
          `  Source:    ${mr.source_branch} → ${mr.target_branch}`,
          `  Author:    ${mr.author?.name || 'unknown'}`,
          mr.web_url ? `  URL:       ${mr.web_url}` : '',
        ];
        return lines.filter(Boolean).join('\n');
      } else {
        // List open MRs
        const result = await gitlabApi(
          `projects/${projectId}/merge_requests?state=opened&per_page=10`
        );

        if (!result.ok) return `Failed to list MRs: ${result.error}`;

        const mrs = result.data as any[];
        if (!mrs || mrs.length === 0) return 'No open merge requests.';

        const lines = [`${mrs.length} open MR(s):`];
        for (const mr of mrs) {
          lines.push(
            `  !${mr.iid}: ${mr.title} [${mr.merge_status}] (${mr.source_branch} → ${mr.target_branch})`
          );
        }
        return lines.join('\n');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: ${msg}`;
    }
  },
});
