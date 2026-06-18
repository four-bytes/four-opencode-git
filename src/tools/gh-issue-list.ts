// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface IssueInfo {
  number: number;
  title: string;
  state: string;
  labels: string[];
  assignees: string[];
  url: string;
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

function formatIssueList(issues: IssueInfo[], repo: string, state: string): string {
  if (issues.length === 0) {
    return `GH ISSUE LIST — ${repo} — no ${state} issues found.`;
  }

  const lines: string[] = [];
  lines.push(
    `GH ISSUE LIST — ${repo} — ${issues.length} ${state} issue${issues.length !== 1 ? 's' : ''}`
  );
  lines.push('');

  for (const issue of issues) {
    const labelStr = issue.labels.length > 0 ? ` [${issue.labels.join(', ')}]` : '';
    const assigneeStr = issue.assignees.length > 0 ? ` (@${issue.assignees.join(', @')})` : '';
    const dateStr = issue.updatedAt.slice(0, 10);

    lines.push(`  #${String(issue.number).padEnd(6)} ${issue.title}`);
    lines.push(`          ${issue.state}${labelStr}${assigneeStr} — updated ${dateStr}`);
    lines.push(`          ${issue.url}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghIssueListTool = tool({
  description:
    'List GitHub issues with filtering. Wraps `gh issue list --json` into structured output. Saves ~90% tokens vs. bash→read→parse. Use for triage, backlog grooming, and issue discovery.',

  args: {
    repo: tool.schema
      .string()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
    state: tool.schema
      .string()
      .describe("Issue state filter: 'open', 'closed', or 'all' (default: 'open')"),
    label: tool.schema
      .string()
      .describe('Filter by label (comma-separated for multiple, e.g. "bug,help wanted")'),
    assignee: tool.schema
      .string()
      .describe('Filter by assignee username (use "@me" for current user)'),
    limit: tool.schema.number().describe('Maximum number of issues to return (default: 30)'),
    search: tool.schema.string().describe('Search term to filter issues by title/body'),
  },

  async execute(args, ctx) {
    const repo = args.repo as string | undefined;
    const state = ((args.state as string) ?? 'open').toLowerCase();
    const label = args.label as string | undefined;
    const assignee = args.assignee as string | undefined;
    const limit = (args.limit as number) ?? 30;
    const search = args.search as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('gh_issue_list.start', { repo, state, label, assignee, limit, search });

    try {
      const resolvedRepo = await resolveRepo(repo, cwd);

      // Validate state
      if (!['open', 'closed', 'all'].includes(state)) {
        return `Error: Invalid state "${state}". Must be "open", "closed", or "all".`;
      }

      // Build gh args
      const ghArgs: string[] = [
        'issue',
        'list',
        '--repo',
        resolvedRepo,
        '--state',
        state,
        '--limit',
        String(limit),
        '--json',
        'number,title,state,labels,assignees,url,updatedAt',
      ];

      if (label) {
        ghArgs.push('--label', label);
      }
      if (assignee) {
        ghArgs.push('--assignee', assignee);
      }
      if (search) {
        ghArgs.push('--search', search);
      }

      const rawJson = await runGh(ghArgs, cwd);

      let issues: IssueInfo[];
      try {
        issues = JSON.parse(rawJson) as IssueInfo[];
      } catch {
        return `Error parsing gh issue list output. Raw output:\n${rawJson}`;
      }

      // Extract label names (gh returns {name, color, ...} objects)
      const normalized = issues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: (issue.labels || []).map((l: unknown) =>
          typeof l === 'string' ? l : ((l as { name?: string })?.name ?? String(l))
        ),
        assignees: (issue.assignees || []).map((a: unknown) =>
          typeof a === 'string' ? a : ((a as { login?: string })?.login ?? String(a))
        ),
        url: issue.url,
        updatedAt: issue.updatedAt,
      }));

      logDebugEvent('gh_issue_list.done', { count: normalized.length });
      return formatIssueList(normalized, resolvedRepo, state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_issue_list.error', { error: msg });
      return `Error listing issues: ${msg}`;
    }
  },
});

export { formatIssueList };
