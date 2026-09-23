// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { getGitLabConfig, getGitLabProjectId, gitlabApi } from '../lib/gitlab-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface GitLabIssueListItem {
  number: number;
  title: string;
  state: string;
  labels: string[];
  assignees: string[];
  url?: string;
  updatedAt?: string;
}

// ────────────────────────────────────────────────────────────────
// Normalization
// ────────────────────────────────────────────────────────────────

/**
 * Map raw GitLab API issue objects to the normalized shape.
 * GitLab uses `iid` for the project-scoped issue number and `web_url` for the
 * browser URL. Labels are `string[]`; assignees are `{username, ...}` objects.
 * Exported for testing with fixture JSON.
 */
export function normalizeGitLabIssues(raw: unknown): GitLabIssueListItem[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((issue: any) => ({
    number: issue.iid,
    title: issue.title,
    state: issue.state,
    labels: (issue.labels || []).map((l: unknown) =>
      typeof l === 'string' ? l : ((l as { name?: string })?.name ?? String(l))
    ),
    assignees: (issue.assignees || []).map((a: unknown) => {
      if (typeof a === 'string') return a;
      const user = a as { username?: string; name?: string };
      return user?.username ?? user?.name ?? String(a);
    }),
    url: issue.web_url,
    updatedAt: issue.updated_at,
  }));
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

/**
 * Pure formatter — one line per issue, `#N [labels] title`.
 * Exported for testing without a repo or API.
 */
export function formatGitLabIssueList(
  issues: GitLabIssueListItem[],
  repo: string,
  state: string
): string {
  if (issues.length === 0) {
    return `GITLAB ISSUE LIST — ${repo} — no ${state} issues found.`;
  }

  const lines: string[] = [];
  lines.push(
    `GITLAB ISSUE LIST — ${repo} — ${issues.length} ${state} issue${issues.length !== 1 ? 's' : ''}`
  );
  lines.push('');

  for (const issue of issues) {
    const labelStr = issue.labels.length > 0 ? ` [${issue.labels.join(', ')}]` : '';
    lines.push(`  #${issue.number}${labelStr} ${issue.title}`);
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const gitlabIssueListTool = tool({
  description:
    'List GitLab issues via the REST API with state/label/assignee/search filters, one line per issue. Mirrors gh_issue_list for GitLab projects.',

  args: {
    repo: tool.schema
      .string()
      .optional()
      .describe('GitLab project in group/project format (optional override of the origin remote)'),
    project: tool.schema
      .string()
      .optional()
      .describe('Alias for `repo` — GitLab project path or numeric project ID'),
    state: tool.schema
      .string()
      .optional()
      .describe("Issue state filter: 'open', 'closed', or 'all' (default: 'open')"),
    label: tool.schema
      .string()
      .optional()
      .describe('Filter by label (comma-separated for multiple, e.g. "bug,help wanted")'),
    assignee: tool.schema.string().optional().describe('Filter by assignee username'),
    limit: tool.schema
      .number()
      .optional()
      .describe('Maximum number of issues to return (default: 20)'),
    search: tool.schema
      .string()
      .optional()
      .describe('Search term to filter issues by title/description'),
  },

  async execute(args, ctx) {
    const state = ((args.state as string) ?? 'open').toLowerCase();
    const label = args.label as string | undefined;
    const assignee = args.assignee as string | undefined;
    const limit = (args.limit as number) ?? 20;
    const search = args.search as string | undefined;
    const override = (args.project as string | undefined) ?? (args.repo as string | undefined);
    const cwd = ctx.directory;

    logDebugEvent('gitlab_issue_list.start', {
      override,
      state,
      label,
      assignee,
      limit,
      search,
    });

    try {
      const cfg = getGitLabConfig();
      if (!cfg) return 'GitLab not configured (GITLAB_TOKEN not set)';

      if (!['open', 'closed', 'all'].includes(state)) {
        return `Error: Invalid state "${state}". Must be "open", "closed", or "all".`;
      }

      const projectId = override
        ? encodeURIComponent(override)
        : await getGitLabProjectId(cwd);
      if (!projectId) return 'Could not determine GitLab project ID.';

      // GitLab's API spells the open state "opened".
      const apiState = state === 'open' ? 'opened' : state;

      const params = new URLSearchParams();
      params.set('state', apiState);
      params.set('per_page', String(limit));
      if (label) params.set('labels', label);
      if (assignee) params.set('assignee_username', assignee);
      if (search) params.set('search', search);

      const result = await gitlabApi(`projects/${projectId}/issues?${params.toString()}`);
      if (!result.ok) return `Failed to list issues: ${result.error}`;

      const normalized = normalizeGitLabIssues(result.data);

      logDebugEvent('gitlab_issue_list.done', { count: normalized.length });
      return formatGitLabIssueList(normalized, decodeURIComponent(projectId), state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gitlab_issue_list.error', { error: msg });
      return `Error listing issues: ${msg}`;
    }
  },
});
