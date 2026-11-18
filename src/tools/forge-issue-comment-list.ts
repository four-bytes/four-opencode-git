// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { runGh } from '../lib/gh-utils';
import { listForgejoIssueComments } from './forgejo-issue-comments';
import { summarizeBody } from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

/** One line per GitHub comment. Pure — exported for testing. */
export function formatGhIssueComments(raw: unknown, issue: number, limit: number): string {
  const all = Array.isArray(raw) ? raw : [];
  if (all.length === 0) return `GH COMMENTS — #${issue} — none`;
  const shown = all.slice(-limit);
  const header =
    shown.length < all.length
      ? `GH COMMENTS — #${issue} — last ${shown.length} of ${all.length}`
      : `GH COMMENTS — #${issue} — ${all.length}`;
  const lines = shown.map((c: any) => {
    const date = typeof c.created_at === 'string' ? c.created_at.slice(0, 10) : '????-??-??';
    const author = c.user?.login ?? 'unknown';
    return `  ${date} ${author}: ${summarizeBody(typeof c.body === 'string' ? c.body : '')}`;
  });
  return [header, '', ...lines].join('\n');
}

/**
 * List comments on a GitHub issue (repo already resolved). Paginates to the end
 * (100 per page), so `slice(-limit)` returns the true newest N comments — GitHub
 * serves comments in ascending order.
 */
async function listGhIssueComments(repo: string, issueNum: number, limit: number, cwd: string): Promise<string> {
  const rawJson = await runGh(
    ['api', '--paginate', '--slurp', `repos/${repo}/issues/${issueNum}/comments?per_page=100`],
    cwd,
  );
  let raw: unknown;
  try {
    const parsed: unknown = JSON.parse(rawJson);
    // --slurp wraps all pages in one outer array; flatten to a single comment list.
    raw = Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0]) ? (parsed as unknown[][]).flat() : parsed;
  } catch {
    return `Error parsing gh api output. Raw output:\n${rawJson}`;
  }
  return formatGhIssueComments(raw, issueNum, limit);
}

export const forgeIssueCommentListTool = tool({
  description:
    'Read the comments on an issue (or PR) of the current repo regardless of forge. Detects GitHub/Forgejo from the origin remote (override with `backend`); one line per comment (date, author, first line), newest N.',
  args: {
    issue: tool.schema.number().describe('Issue or PR number'),
    limit: tool.schema.number().optional().describe('How many of the most recent comments to show (default: 10)'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const limit = Math.max(1, (args.limit as number | undefined) ?? 10);
    const repo = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_issue_comment_list.start', { issue: issueNum, limit });

    try {
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo });
      if (!resolved.ok) return resolved.message;
      const { backend, repo: target } = resolved.ctx;

      if (backend === 'gitlab') return 'GitLab issue comments are not supported yet.';
      return backend === 'forgejo'
        ? listForgejoIssueComments(target!, issueNum, limit, cwd)
        : listGhIssueComments(target!, issueNum, limit, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_issue_comment_list.error', { error: msg });
      return `Error reading comments: ${msg}`;
    }
  },
});
