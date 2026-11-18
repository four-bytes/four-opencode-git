// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { forgejoApi, getForgejoConfig, getForgejoRepo, summarizeBody } from '../lib/forgejo-utils';
import {
  fetchReviewSummary,
  formatReviewLine,
  isBotLogin,
  type ReviewSummary,
} from '../lib/forgejo-reviews';
import { logDebugEvent } from '../lib/debug-logger';

interface Entry {
  at: string;
  line: string;
}

const day = (iso: string) => (iso ? iso.slice(0, 10) : '????-??-??');

/**
 * Conversation comments, review verdicts and inline review comments, merged in
 * time order, one line each. Open human inline comments are marked `OPEN`.
 * Pure — exported for testing.
 */
export function formatForgejoPrComments(
  n: number,
  conversation: unknown,
  summary: ReviewSummary,
  limit: number
): string {
  const entries: Entry[] = [];

  for (const c of Array.isArray(conversation) ? conversation : []) {
    const author = (c as any)?.user?.login ?? 'unknown';
    const bot = isBotLogin(author) ? ' (bot)' : '';
    entries.push({
      at: (c as any)?.created_at ?? '',
      line: `  ${day((c as any)?.created_at ?? '')} ${author}${bot}: ${summarizeBody((c as any)?.body ?? '')}`,
    });
  }

  for (const r of summary.reviews) {
    if (r.state === 'PENDING') continue;
    const flags = [r.bot ? 'bot' : '', r.active ? '' : 'dismissed/stale'].filter(Boolean).join(', ');
    const body = r.body.trim() ? `: ${summarizeBody(r.body)}` : '';
    entries.push({
      at: r.submittedAt,
      line: `  ${day(r.submittedAt)} ${r.author} ${r.state}${flags ? ` (${flags})` : ''}${body}`,
    });
  }

  const open = new Set(summary.openHumanThreads.map((t) => t.key));
  const resolved = new Set(summary.conversations.filter((t) => t.resolved).map((t) => t.key));
  for (const c of summary.comments) {
    const where = c.line ? `${c.path}:${c.line}` : c.path;
    const key = `${c.path}:${c.line ?? ''}`;
    const mark = open.has(key) ? 'OPEN ' : resolved.has(key) ? 'resolved ' : '';
    entries.push({
      at: c.createdAt,
      line: `  ${day(c.createdAt)} ${c.author}${c.bot ? ' (bot)' : ''} ${mark}${where}: ${summarizeBody(c.body)}`,
    });
  }

  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const shown = entries.slice(-limit);
  const count =
    shown.length < entries.length ? `last ${shown.length} of ${entries.length}` : `${entries.length}`;

  return [
    `FORGEJO PR !${n} — ${count} comment(s)`,
    `  threads   ${formatReviewLine(summary)}`,
    ...(shown.length > 0 ? ['', ...shown.map((e) => e.line)] : []),
  ].join('\n');
}

// ────────────────────────────────────────────────────────────────
// Core — reusable, takes an already-resolved repo
// ────────────────────────────────────────────────────────────────

/** Read + format a Forgejo PR's conversation, review verdicts and inline comments. */
export async function getForgejoPrComments(
  repo: string,
  pr: number,
  limit: number,
  cwd: string
): Promise<string> {
  const cfg = getForgejoConfig(cwd);
  if (!cfg.ok) return cfg.message;
  const config = cfg.config;

  const view = await forgejoApi(`/repos/${repo}/pulls/${pr}`, config);
  if (!view.ok) return `Failed to get PR !${pr}: ${view.error}`;

  // Conversation comments live on the issue side of the PR (not paginated).
  const conversation = await forgejoApi(`/repos/${repo}/issues/${pr}/comments`, config);
  if (!conversation.ok) return `Error reading comments on !${pr}: ${conversation.error}`;

  const summary = await fetchReviewSummary(repo, pr, view.data?.user?.login ?? '', config);
  if (!summary) return `Error reading reviews on !${pr}.`;

  logDebugEvent('forgejo_pr_comments.done', { pr, open: summary.openHumanThreads.length });
  return formatForgejoPrComments(pr, conversation.data, summary, limit);
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoPrCommentsTool = tool({
  description:
    'Read a Forgejo PR\'s conversation, review verdicts and inline review comments — one line each, time-ordered — and report open human threads (unresolved inline conversations or requested changes by someone other than the author). An open human thread blocks forgejo_pr_merge; bot findings never do. A reply does not resolve a thread — it is resolved in the Forgejo UI.',

  args: {
    pr: tool.schema.number().describe('PR number'),
    limit: tool.schema
      .number()
      .optional()
      .describe('How many of the most recent entries to show (default: 20)'),
  },

  async execute(args, ctx) {
    const n = args.pr as number;
    const limit = Math.max(1, (args.limit as number | undefined) ?? 20);
    const cwd = ctx.directory;

    logDebugEvent('forgejo_pr_comments.start', { pr: n, limit });

    try {
      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return cfg.message;

      const repo = await getForgejoRepo(cwd);
      if (!repo) return 'Could not determine Forgejo repository from origin remote.';

      return await getForgejoPrComments(repo, n, limit, cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_pr_comments.error', { error: msg });
      return `Error reading PR comments: ${msg}`;
    }
  },
});
