// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

export const ghPrReviewTool = tool({
  description:
    'Fetch review comments and reviews on a GitHub pull request. Returns structured feedback including review state (APPROVED/CHANGES_REQUESTED/COMMENTED) and comment bodies. Saves ~90% tokens vs. bash→read→parse.',

  args: {
    pr: tool.schema.number().describe('PR number to review'),
    repo: tool.schema
      .string()
      .optional()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
  },

  async execute(args, ctx) {
    const { pr, repo } = args;

    logDebugEvent('gh_pr_review.start', { pr });

    try {
      const resolvedRepo = await resolveRepo(repo, ctx.directory);
      const repoArgs = ['-R', resolvedRepo];

      // Fetch issue-level comments + review summaries
      // Note: `comments` are issue/timeline comments; `reviews` are formal review submissions.
      // Inline diff comments (with path/line) require GraphQL — out of scope for v1.
      const output = await runGh(
        ['pr', 'view', String(pr), ...repoArgs, '--json', 'comments,reviews'],
        ctx.directory
      );

      const data = JSON.parse(output) as {
        comments?: Array<{
          author?: { login?: string };
          body?: string;
          createdAt?: string;
        }>;
        reviews?: Array<{
          author?: { login?: string };
          state?: string;
          body?: string;
          submittedAt?: string;
        }>;
      };

      const comments = data.comments ?? [];
      const reviews = data.reviews ?? [];

      if (comments.length === 0 && reviews.length === 0) {
        return `No review comments on PR #${pr}.`;
      }

      const lines: string[] = [`Review comments for PR #${pr}:`, ''];

      if (reviews.length > 0) {
        lines.push('## Reviews');
        lines.push('');
        for (const review of reviews) {
          const reviewer = review.author?.login ?? 'unknown';
          const state = review.state ?? 'COMMENTED';
          const ts = review.submittedAt ? ` (${review.submittedAt})` : '';
          const bodyText = (review.body ?? '').trim() || '(no comment)';
          const body = bodyText.length > 500 ? `${bodyText.substring(0, 500)}…` : bodyText;
          lines.push(`[${state}] ${reviewer}${ts}:`);
          lines.push(body);
          lines.push('');
        }
      }

      if (comments.length > 0) {
        lines.push('## Comments');
        lines.push('');
        for (const comment of comments) {
          const author = comment.author?.login ?? 'unknown';
          const ts = comment.createdAt ? ` (${comment.createdAt})` : '';
          const body =
            (comment.body ?? '').length > 300
              ? `${comment.body!.substring(0, 300)}…`
              : (comment.body ?? '');
          lines.push(`${author}${ts}:`);
          lines.push(`  ${body}`);
          lines.push('');
        }
      }

      logDebugEvent('gh_pr_review.success', {
        pr,
        comments: comments.length,
        reviews: reviews.length,
      });

      return lines.join('\n').trimEnd();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_pr_review.error', { error: msg });
      return `Error fetching PR comments: ${msg}`;
    }
  },
});
