// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import {
  fetchGhReviewSummary,
  formatGhReviewLine,
  isBotLogin,
  type GhReviewSummary,
} from '../lib/gh-reviews';
import { logDebugEvent } from '../lib/debug-logger';

interface Entry {
  at: string;
  line: string;
}

const day = (iso: string) => (iso ? iso.slice(0, 10) : '????-??-??');

/** First line of a body, trimmed to `max` characters — mirrors forgejo-utils `summarizeBody`. */
function firstLine(body: string, max = 100): string {
  const lines = body.replace(/\r\n/g, '\n').trim().split('\n');
  let line = (lines[0] ?? '').trim();
  if (line.length > max) line = `${line.slice(0, max - 1)}…`;
  const rest = lines.length - 1;
  return rest > 0 ? `${line} (+${rest} lines)` : line;
}

/**
 * Conversation comments, review verdicts and inline review comments, merged in
 * time order, one line each. Open human inline threads are marked `OPEN`.
 * Pure — exported for testing.
 */
export function formatGhPrComments(
  n: number,
  conversationComments: unknown,
  summary: GhReviewSummary,
  limit: number
): string {
  const entries: Entry[] = [];

  for (const c of Array.isArray(conversationComments) ? conversationComments : []) {
    const author = (c as any)?.user?.login ?? 'unknown';
    const bot = isBotLogin(author) ? ' (bot)' : '';
    const createdAt = (c as any)?.created_at ?? '';
    entries.push({
      at: createdAt,
      line: `  ${day(createdAt)} ${author}${bot}: ${firstLine((c as any)?.body ?? '')}`,
    });
  }

  for (const r of summary.reviews) {
    if (r.state === 'PENDING' || r.dismissed) continue;
    const bot = r.bot ? ' (bot)' : '';
    const body = r.body.trim() ? `: ${firstLine(r.body)}` : '';
    entries.push({
      at: r.submittedAt,
      line: `  ${day(r.submittedAt)} ${r.author} ${r.state}${bot}${body}`,
    });
  }

  const open = new Set(summary.openHumanThreads.map((t) => t.key));
  const resolved = new Set(summary.threads.filter((t) => t.resolved).map((t) => t.key));
  for (const t of summary.threads) {
    for (const c of t.comments) {
      const where = c.line ? `${c.path}:${c.line}` : c.path;
      const mark = open.has(t.key) ? 'OPEN ' : resolved.has(t.key) ? 'resolved ' : '';
      entries.push({
        at: c.createdAt,
        line: `  ${day(c.createdAt)} ${c.author}${c.bot ? ' (bot)' : ''} ${mark}${where}: ${firstLine(c.body)}`,
      });
    }
  }

  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const shown = entries.slice(-limit);
  const count =
    shown.length < entries.length ? `last ${shown.length} of ${entries.length}` : `${entries.length}`;

  return [
    `GH PR #${n} — ${count} comment(s)`,
    `  threads   ${formatGhReviewLine(summary)}`,
    ...(shown.length > 0 ? ['', ...shown.map((e) => e.line)] : []),
  ].join('\n');
}

// ────────────────────────────────────────────────────────────────
// Core — reusable, takes an already-resolved repo
// ────────────────────────────────────────────────────────────────

/** Read + format a GitHub PR's conversation, review verdicts and inline comments. */
export async function getGhPrComments(
  repo: string,
  pr: number,
  limit: number,
  cwd: string
): Promise<string> {
  const prAuthor = (
    await runGh(
      ['pr', 'view', String(pr), '-R', repo, '--json', 'author', '--jq', '.author.login'],
      cwd
    )
  ).trim();

  // Conversation comments live on the issue side of the PR (not paginated).
  const conversation = JSON.parse(
    await runGh(['api', `repos/${repo}/issues/${pr}/comments`], cwd)
  );

  const summary = await fetchGhReviewSummary(repo, pr, prAuthor, cwd);
  if (!summary) return `Error reading reviews on PR #${pr}.`;

  logDebugEvent('gh_pr_comments.done', { pr, open: summary.openHumanThreads.length });
  return formatGhPrComments(pr, conversation, summary, limit);
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghPrCommentsTool = tool({
  description:
    "Read a GitHub PR's conversation, review verdicts and inline review comments — one line each, time-ordered — and report open human threads (unresolved inline conversations or changes requested by someone other than the author). An open human thread blocks merge; bot findings never do. A reply does not resolve a thread — it is resolved in the GitHub UI.",

  args: {
    pr: tool.schema.number().describe('PR number'),
    repo: tool.schema
      .string()
      .optional()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
    limit: tool.schema
      .number()
      .optional()
      .describe('How many of the most recent entries to show (default: 20)'),
  },

  async execute(args, ctx) {
    const n = args.pr as number;
    const limit = Math.max(1, (args.limit as number | undefined) ?? 20);
    const cwd = ctx.directory;

    logDebugEvent('gh_pr_comments.start', { pr: n, limit });

    try {
      const resolvedRepo = await resolveRepo(args.repo, cwd);
      return await getGhPrComments(resolvedRepo, n, limit, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_pr_comments.error', { error: msg });
      return `Error reading PR comments: ${msg}`;
    }
  },
});
