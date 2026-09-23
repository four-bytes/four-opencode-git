// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import {
  forgejoApi,
  forgejoConfigMessage,
  getForgejoConfig,
  getForgejoRepo,
} from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface ForgejoIssueListItem {
  number: number;
  title: string;
  state: string;
  labels: string[];
  assignees: string[];
  html_url?: string;
  updated_at?: string;
}

// ────────────────────────────────────────────────────────────────
// Normalization
// ────────────────────────────────────────────────────────────────

/**
 * Map raw Forgejo API issue objects to the normalized shape.
 * Labels arrive as `{name, color, ...}` and assignees as `{login, ...}`.
 * Exported for testing with fixture JSON.
 */
export function normalizeForgejoIssueListItems(raw: unknown): ForgejoIssueListItem[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((issue: any) => ({
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: (issue.labels || []).map((l: unknown) =>
      typeof l === 'string' ? l : ((l as { name?: string })?.name ?? String(l))
    ),
    assignees: (issue.assignees || []).map((a: unknown) =>
      typeof a === 'string' ? a : ((a as { login?: string })?.login ?? String(a))
    ),
    html_url: issue.html_url,
    updated_at: issue.updated_at,
  }));
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

/**
 * Pure formatter — one line per issue, `#N [labels] title`.
 * Exported for testing without a repo or API.
 */
function formatForgejoIssueList(
  issues: ForgejoIssueListItem[],
  repo: string,
  state: string
): string {
  if (issues.length === 0) {
    return `FORGEJO ISSUE LIST — ${repo} — no ${state} issues found.`;
  }

  const lines: string[] = [];
  lines.push(
    `FORGEJO ISSUE LIST — ${repo} — ${issues.length} ${state} issue${issues.length !== 1 ? 's' : ''}`
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

export const forgejoIssueListTool = tool({
  description:
    'List Forgejo issues via the REST API with state/label/assignee filters, one line per issue. Forgejo state queries go through this tool — fj has no --json.',

  args: {
    state: tool.schema
      .string()
      .describe("Issue state filter: 'open', 'closed', or 'all' (default: 'open')"),
    label: tool.schema
      .string()
      .describe('Filter by label (comma-separated for multiple, e.g. "bug,help wanted")'),
    assignee: tool.schema.string().describe('Filter by assignee username'),
    limit: tool.schema.number().describe('Maximum number of issues to return (default: 20)'),
  },

  async execute(args, ctx) {
    const state = ((args.state as string) ?? 'open').toLowerCase();
    const label = args.label as string | undefined;
    const assignee = args.assignee as string | undefined;
    const limit = (args.limit as number) ?? 20;
    const cwd = ctx.directory;

    logDebugEvent('forgejo_issue_list.start', { state, label, assignee, limit });

    try {
      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return forgejoConfigMessage(cfg.reason);
      const config = cfg.config;

      const repo = await getForgejoRepo(cwd);
      if (!repo) return 'Could not determine Forgejo repository from origin remote.';

      if (!['open', 'closed', 'all'].includes(state)) {
        return `Error: Invalid state "${state}". Must be "open", "closed", or "all".`;
      }

      const params = new URLSearchParams();
      params.set('state', state);
      params.set('limit', String(limit));
      if (label) params.set('labels', label);
      if (assignee) params.set('assignee', assignee);

      const result = await forgejoApi(`/repos/${repo}/issues?${params.toString()}`, config);
      if (!result.ok) return `Failed to list issues: ${result.error}`;

      const normalized = normalizeForgejoIssueListItems(result.data);

      logDebugEvent('forgejo_issue_list.done', { count: normalized.length });
      return formatForgejoIssueList(normalized, repo, state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_issue_list.error', { error: msg });
      return `Error listing issues: ${msg}`;
    }
  },
});

export { formatForgejoIssueList };
