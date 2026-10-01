// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { forgejoApi, forgejoApiAll, type ForgejoConfig } from './forgejo-utils';

/**
 * Review state of a Forgejo PR, shaped for the merge rule "an open human thread
 * blocks merge regardless of score". Bot findings are advisory and never block.
 *
 * Inline comments are grouped into conversations by file + line. Forgejo sets
 * `resolver` on the conversation's root comment only, so a conversation counts
 * as resolved when ANY of its comments carries one. A conversation is an open
 * human thread when it is unresolved and contains a comment by someone other
 * than the PR author that is not a bot. Comments of dismissed reviews are
 * ignored. A reply alone never resolves a thread — the reviewer (or anyone with
 * write access) resolves it in the Forgejo UI, which is what the merge rule
 * "reply until they resolve" asks for.
 *
 * Changes requested: the latest non-dismissed, non-stale APPROVED /
 * REQUEST_CHANGES verdict per human reviewer decides.
 */

export interface ReviewComment {
  id: number;
  reviewId: number;
  author: string;
  path: string;
  line: number | null;
  body: string;
  createdAt: string;
  resolved: boolean;
  bot: boolean;
}

export interface Review {
  id: number;
  author: string;
  state: string;
  body: string;
  submittedAt: string;
  dismissed: boolean;
  active: boolean;
  bot: boolean;
}

export interface Conversation {
  key: string;
  path: string;
  line: number | null;
  comments: ReviewComment[];
  resolved: boolean;
}

export interface ReviewSummary {
  reviews: Review[];
  comments: ReviewComment[];
  conversations: Conversation[];
  /** Unresolved conversations with a comment by a human other than the PR author. */
  openHumanThreads: Conversation[];
  /** Humans whose latest active review is REQUEST_CHANGES. */
  changesRequestedBy: string[];
}

/** `coderabbitai[bot]`, `renovate-bot`, `ci_bot`, `bot` — login-based heuristic (`abbot` is human). */
export function isBotLogin(login: string): boolean {
  return /(?:\[bot\]|[-_]bot)$|^bot$/i.test(login);
}

/** Pure: raw API JSON → summary. Exported for testing. */
export function summarizeReviews(
  rawReviews: unknown,
  rawCommentsByReview: Record<number, unknown>,
  prAuthor: string
): ReviewSummary {
  const reviews: Review[] = (Array.isArray(rawReviews) ? rawReviews : []).map((r: any) => {
    const author = r?.user?.login ?? 'unknown';
    return {
      id: r?.id,
      author,
      state: String(r?.state ?? ''),
      body: typeof r?.body === 'string' ? r.body : '',
      submittedAt: typeof r?.submitted_at === 'string' ? r.submitted_at : '',
      dismissed: r?.dismissed === true,
      active: r?.dismissed !== true && r?.stale !== true,
      bot: isBotLogin(author),
    };
  });

  const comments: ReviewComment[] = [];
  for (const review of reviews) {
    if (review.dismissed) continue;
    const raw = rawCommentsByReview[review.id];
    for (const c of Array.isArray(raw) ? raw : []) {
      const author = (c as any)?.user?.login ?? review.author;
      comments.push({
        id: (c as any)?.id,
        reviewId: review.id,
        author,
        path: (c as any)?.path ?? '',
        line: (c as any)?.position ?? (c as any)?.original_position ?? null,
        body: typeof (c as any)?.body === 'string' ? (c as any).body : '',
        createdAt: (c as any)?.created_at ?? '',
        resolved: (c as any)?.resolver != null,
        bot: isBotLogin(author),
      });
    }
  }

  // Forgejo shows all comments on one file line as one conversation, so two
  // threads started on the same line are deliberately treated as one.
  const byKey = new Map<string, Conversation>();
  for (const c of comments) {
    const key = `${c.path}:${c.line ?? ''}`;
    let conv = byKey.get(key);
    if (!conv) {
      conv = { key, path: c.path, line: c.line, comments: [], resolved: false };
      byKey.set(key, conv);
    }
    conv.comments.push(c);
    if (c.resolved) conv.resolved = true;
  }
  const conversations = [...byKey.values()];
  const openHumanThreads = conversations.filter(
    (conv) => !conv.resolved && conv.comments.some((c) => !c.bot && c.author !== prAuthor)
  );

  // Latest active verdict per human reviewer decides.
  const latest = new Map<string, Review>();
  for (const r of reviews) {
    if (r.bot || !r.active || r.author === prAuthor) continue;
    if (!['APPROVED', 'REQUEST_CHANGES'].includes(r.state)) continue;
    const prev = latest.get(r.author);
    if (!prev || r.submittedAt >= prev.submittedAt) latest.set(r.author, r);
  }
  const changesRequestedBy = [...latest.values()]
    .filter((r) => r.state === 'REQUEST_CHANGES')
    .map((r) => r.author);

  return { reviews, comments, conversations, openHumanThreads, changesRequestedBy };
}

/** Whether the summary blocks a merge. */
export function blocksMerge(summary: ReviewSummary): boolean {
  return summary.openHumanThreads.length > 0 || summary.changesRequestedBy.length > 0;
}

/** One line for status/merge output, e.g. `2 open human thread(s) · changes requested by bob`. */
export function formatReviewLine(summary: ReviewSummary): string {
  const parts: string[] = [];
  if (summary.openHumanThreads.length > 0) {
    const where = summary.openHumanThreads.map((t) => (t.line ? `${t.path}:${t.line}` : t.path)).join(', ');
    parts.push(`${summary.openHumanThreads.length} open human thread(s) (${where}) — resolve in the Forgejo UI`);
  }
  if (summary.changesRequestedBy.length > 0) {
    parts.push(`changes requested by ${summary.changesRequestedBy.join(', ')}`);
  }
  if (parts.length === 0) {
    const approved = summary.reviews.filter((r) => r.active && r.state === 'APPROVED' && !r.bot);
    return approved.length > 0
      ? `no open human threads · approved by ${[...new Set(approved.map((r) => r.author))].join(', ')}`
      : 'no open human threads';
  }
  return parts.join(' · ');
}

/** Fetch reviews and their comments. `null` when the review list cannot be read. */
export async function fetchReviewSummary(
  repo: string,
  pr: number,
  prAuthor: string,
  config: ForgejoConfig
): Promise<ReviewSummary | null> {
  const reviews = await forgejoApiAll(`/repos/${repo}/pulls/${pr}/reviews`, config);
  if (!reviews.ok) return null;

  const byReview: Record<number, unknown> = {};
  for (const r of reviews.data as any[]) {
    if (!r?.id || !(r.comments_count > 0)) continue;
    const comments = await forgejoApi(`/repos/${repo}/pulls/${pr}/reviews/${r.id}/comments`, config);
    if (!comments.ok) return null;
    byReview[r.id] = comments.data;
  }

  return summarizeReviews(reviews.data, byReview, prAuthor);
}
