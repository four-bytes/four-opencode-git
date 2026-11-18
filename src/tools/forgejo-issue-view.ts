// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import {
  forgejoApi,
  getForgejoConfig,
  getForgejoRepo,
} from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface ForgejoIssueView {
  number: number;
  title: string;
  state: string;
  labels: string[];
  assignees: string[];
  body: string;
  comments: number;
  html_url?: string;
}

// ────────────────────────────────────────────────────────────────
// Normalization
// ────────────────────────────────────────────────────────────────

/**
 * Map a raw Forgejo API issue object to the normalized shape.
 * Labels arrive as `{name, color, ...}`, assignees as `{login, ...}`, and
 * `comments` as a number. `commentCountOverride` is used when the caller had to
 * fetch the comment list separately. Exported for testing with fixture JSON.
 */
export function normalizeForgejoIssueView(
  raw: any,
  commentCountOverride?: number
): ForgejoIssueView {
  const comments =
    commentCountOverride ?? (typeof raw.comments === 'number' ? raw.comments : 0);

  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    labels: (raw.labels || []).map((l: unknown) =>
      typeof l === 'string' ? l : ((l as { name?: string })?.name ?? String(l))
    ),
    assignees: (raw.assignees || []).map((a: unknown) =>
      typeof a === 'string' ? a : ((a as { login?: string })?.login ?? String(a))
    ),
    body: typeof raw.body === 'string' ? raw.body : '',
    comments,
    html_url: raw.html_url,
  };
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

/** Pure formatter — exported for testing without a repo or API. */
function formatForgejoIssueView(issue: ForgejoIssueView, repo: string): string {
  const lines: string[] = [];

  lines.push(`FORGEJO ISSUE #${issue.number} — ${issue.title}`);
  lines.push(`  repo       ${repo}`);
  lines.push(`  state      ${issue.state}`);
  lines.push(`  labels     ${issue.labels.length > 0 ? issue.labels.join(', ') : '—'}`);
  lines.push(`  comments   ${issue.comments}`);
  if (issue.html_url) lines.push(`  url        ${issue.html_url}`);

  const body = issue.body;
  if (body) {
    lines.push('');
    lines.push(body);
  }

  return lines.join('\n');
}

/** Fetch + format a single Forgejo issue (repo already resolved). */
export async function getForgejoIssue(repo: string, issueNum: number, cwd: string): Promise<string> {
  const cfg = getForgejoConfig(cwd);
  if (!cfg.ok) return cfg.message;
  const config = cfg.config;

  const result = await forgejoApi(`/repos/${repo}/issues/${issueNum}`, config);
  if (!result.ok) return `Failed to get issue #${issueNum}: ${result.error}`;
  const issue = result.data as any;

  let commentCount: number | undefined =
    typeof issue.comments === 'number' ? issue.comments : undefined;
  if (commentCount === undefined) {
    const commentsResult = await forgejoApi(`/repos/${repo}/issues/${issueNum}/comments`, config);
    commentCount = commentsResult.ok && Array.isArray(commentsResult.data) ? commentsResult.data.length : 0;
  }

  const normalized = normalizeForgejoIssueView(issue, commentCount);
  return formatForgejoIssueView(normalized, repo);
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoIssueViewTool = tool({
  description:
    'Read a Forgejo issue — number, title, state, labels, body (full), comment count. Forgejo state queries go through this tool — fj has no --json.',

  args: {
    issue: tool.schema.number().describe('Issue number (index) to view'),
  },

  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const cwd = ctx.directory;

    logDebugEvent('forgejo_issue_view.start', { issue: issueNum });

    try {
      const repo = await getForgejoRepo(cwd);
      if (!repo) return 'Could not determine Forgejo repository from origin remote.';

      logDebugEvent('forgejo_issue_view.done', { issue: issueNum });
      return getForgejoIssue(repo, issueNum, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_issue_view.error', { error: msg });
      return `Error viewing issue: ${msg}`;
    }
  },
});

export { formatForgejoIssueView };
