// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { resolveForgeContext, type Backend } from '../lib/forge-resolver';
import { runGh } from '../lib/gh-utils';
import { createForgejoIssueComment } from './forgejo-issue-comment';
import { logDebugEvent } from '../lib/debug-logger';

/** Post a comment on a GitHub issue (repo already resolved). */
async function createGhIssueComment(repo: string, issueNum: number, body: string, cwd: string): Promise<string> {
  const rawJson = await runGh(['api', `repos/${repo}/issues/${issueNum}/comments`, '-f', `body=${body}`], cwd);
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return `Error parsing gh api output. Raw output:\n${rawJson}`;
  }
  return `✓ Comment posted on #${issueNum}\n  ${parsed?.html_url ?? ''}`.trimEnd();
}

export const forgeIssueCommentCreateTool = tool({
  description:
    'Post a comment on an issue (or PR) of the current repo regardless of forge. Detects GitHub/Forgejo from the origin remote (override with `backend`). The body is a tool argument sent as JSON — backticks and $() arrive verbatim, no shell involved.',
  args: {
    issue: tool.schema.number().describe('Issue or PR number'),
    body: tool.schema.string().describe('Comment text (markdown)'),
    repo: tool.schema.string().optional().describe('Repo in owner/repo format (overrides detection target)'),
    backend: tool.schema.enum(['github', 'gitlab', 'forgejo'], 'Force a backend').optional(),
  },
  async execute(args, ctx) {
    const issueNum = args.issue as number;
    const body = (args.body as string) ?? '';
    const repo = args.repo as string | undefined;
    const backendOverride = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forge_issue_comment_create.start', { issue: issueNum });

    try {
      if (!body.trim()) return 'Error: comment body must not be empty.';
      const resolved = await resolveForgeContext(cwd, { backend: backendOverride, repo });
      if (!resolved.ok) return resolved.message;
      const { backend, repo: target } = resolved.ctx;

      if (backend === 'gitlab') return 'GitLab issue comments are not supported yet.';
      return backend === 'forgejo'
        ? createForgejoIssueComment(target!, issueNum, body, cwd)
        : createGhIssueComment(target!, issueNum, body, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forge_issue_comment_create.error', { error: msg });
      return `Error commenting: ${msg}`;
    }
  },
});
