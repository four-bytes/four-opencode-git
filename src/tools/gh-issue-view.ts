// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface GhIssueView {
  number: number;
  title: string;
  state: string;
  labels: string[];
  assignees: string[];
  body: string;
  commentCount: number;
  url: string;
}

// ────────────────────────────────────────────────────────────────
// Normalization
// ────────────────────────────────────────────────────────────────

/**
 * Map `gh issue view --json` output to the normalized shape. Labels and
 * assignees arrive as objects. Pure — exported for testing with fixture JSON.
 */
export function normalizeGhIssueView(raw: any): GhIssueView {
  return {
    number: raw?.number,
    title: raw?.title ?? '',
    state: String(raw?.state ?? '').toUpperCase(),
    labels: (raw?.labels || []).map((l: unknown) =>
      typeof l === 'string' ? l : ((l as { name?: string })?.name ?? String(l))
    ),
    assignees: (raw?.assignees || []).map((a: unknown) =>
      typeof a === 'string' ? a : ((a as { login?: string })?.login ?? String(a))
    ),
    body: typeof raw?.body === 'string' ? raw.body : '',
    commentCount: Array.isArray(raw?.comments) ? raw.comments.length : 0,
    url: raw?.url ?? '',
  };
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

/** Pure formatter — exported for testing without a repo or API. */
export function formatGhIssueView(issue: GhIssueView, repo: string): string {
  const lines: string[] = [];

  lines.push(`GH ISSUE #${issue.number} — ${issue.title}`);
  lines.push(`  repo       ${repo}`);
  lines.push(`  state      ${issue.state}`);
  lines.push(`  labels     ${issue.labels.length > 0 ? issue.labels.join(', ') : '—'}`);
  lines.push(`  assignees  ${issue.assignees.length > 0 ? issue.assignees.join(', ') : '—'}`);
  lines.push(`  comments   ${issue.commentCount}`);
  if (issue.url) lines.push(`  url        ${issue.url}`);

  const body = issue.body;
  if (body) {
    lines.push('');
    lines.push(body);
  }

  return lines.join('\n');
}

/** Fetch + format a single GitHub issue (repo already resolved). */
export async function getGhIssue(repo: string, issueNum: number, cwd: string): Promise<string> {
  const rawJson = await runGh(
    ['issue', 'view', String(issueNum), '--repo', repo, '--json', 'number,title,state,labels,assignees,body,comments,url'],
    cwd,
  );
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch {
    return `Error parsing gh issue view output. Raw output:\n${rawJson}`;
  }
  const issue = normalizeGhIssueView(raw);
  return formatGhIssueView(issue, repo);
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghIssueViewTool = tool({
  description:
    'Read a GitHub issue — number, title, state, labels, body (full), comment count.',

  args: {
    issue: tool.schema.number().describe('Issue number to view'),
    repo: tool.schema
      .string()
      .optional()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
  },

  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const repo = args.repo as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('gh_issue_view.start', { issue: issueNum });

    try {
      const resolvedRepo = await resolveRepo(repo, cwd);

      logDebugEvent('gh_issue_view.done', { issue: issueNum });
      return getGhIssue(resolvedRepo, issueNum, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_issue_view.error', { error: msg });
      return `Error viewing issue: ${msg}`;
    }
  },
});
