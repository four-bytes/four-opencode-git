// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { runGh } from './gh-utils';

/**
 * Review state of a GitHub PR, shaped for the merge rule "an open human thread
 * blocks merge regardless of score". Bot findings are advisory and never block.
 *
 * GitHub splits review data across two sources:
 *   - REST `pulls/{pr}/reviews` carries the verdicts (APPROVED /
 *     CHANGES_REQUESTED / COMMENTED / DISMISSED / PENDING) but no resolution.
 *   - GraphQL `reviewThreads` is the only place `isResolved` exists (REST
 *     `/threads` does not exist). A thread counts as open human when it is
 *     unresolved and contains a comment by a human other than the PR author.
 *     A reply alone never resolves a thread — it is resolved in the GitHub UI.
 *
 * Changes requested: the latest non-dismissed APPROVED / CHANGES_REQUESTED
 * verdict per human reviewer decides. GitHub exposes neither `stale` nor a
 * dismissal flag on the review list, so every non-DISMISSED review is active.
 */

export interface GhReviewComment {
  author: string;
  path: string;
  line: number | null;
  body: string;
  createdAt: string;
  bot: boolean;
}

export interface GhReview {
  author: string;
  state: string;
  body: string;
  submittedAt: string;
  dismissed: boolean;
  active: boolean;
  bot: boolean;
}

export interface GhThread {
  key: string;
  path: string;
  line: number | null;
  resolved: boolean;
  outdated: boolean;
  comments: GhReviewComment[];
}

export interface GhReviewSummary {
  reviews: GhReview[];
  threads: GhThread[];
  /** Unresolved threads with a comment by a human other than the PR author. */
  openHumanThreads: GhThread[];
  /** Humans whose latest active review is CHANGES_REQUESTED. */
  changesRequestedBy: string[];
}

/** `coderabbitai[bot]`, `renovate-bot`, `ci_bot`, `bot` — login-based heuristic (`abbot` is human). */
export function isBotLogin(login: string): boolean {
  // Deliberately mirrors src/lib/forgejo-reviews.ts — the heuristic is forge-agnostic.
  return /(?:\[bot\]|[-_]bot)$|^bot$/i.test(login);
}

/** Pure: raw REST reviews + GraphQL threads → summary. Exported for testing. */
export function summarizeGhReviews(
  rawReviews: unknown,
  rawThreads: unknown,
  prAuthor: string
): GhReviewSummary {
  const reviews: GhReview[] = (Array.isArray(rawReviews) ? rawReviews : []).map((r: any) => {
    const author = r?.user?.login ?? 'unknown';
    const state = String(r?.state ?? '');
    return {
      author,
      state,
      body: typeof r?.body === 'string' ? r.body : '',
      submittedAt: typeof r?.submitted_at === 'string'
        ? r.submitted_at
        : typeof r?.submittedAt === 'string'
          ? r.submittedAt
          : '',
      dismissed: state === 'DISMISSED',
      active: state !== 'DISMISSED',
      bot: isBotLogin(author),
    };
  });

  const threads: GhThread[] = (Array.isArray(rawThreads) ? rawThreads : []).map((t: any) => {
    const rawComments = Array.isArray(t?.comments?.nodes) ? t.comments.nodes : [];
    const first = rawComments[0];
    const path = typeof t?.path === 'string' ? t.path : (first?.path ?? '');
    const line = typeof t?.line === 'number' ? t.line : (typeof first?.line === 'number' ? first.line : null);

    const comments: GhReviewComment[] = rawComments.map((c: any) => {
      const author = c?.author?.login ?? 'unknown';
      return {
        author,
        path: typeof c?.path === 'string' ? c.path : path,
        line: typeof c?.line === 'number' ? c.line : null,
        body: typeof c?.body === 'string' ? c.body : '',
        createdAt: typeof c?.createdAt === 'string' ? c.createdAt : '',
        bot: isBotLogin(author),
      };
    });

    return {
      key: `${path}:${line ?? ''}`,
      path,
      line,
      resolved: t?.isResolved === true,
      outdated: t?.isOutdated === true,
      comments,
    };
  });

  const openHumanThreads = threads.filter(
    (t) => !t.resolved && t.comments.some((c) => !c.bot && c.author !== prAuthor)
  );

  // Latest active verdict per human reviewer decides.
  const latest = new Map<string, GhReview>();
  for (const r of reviews) {
    if (r.bot || !r.active || r.author === prAuthor) continue;
    if (!['APPROVED', 'CHANGES_REQUESTED'].includes(r.state)) continue;
    const prev = latest.get(r.author);
    if (!prev || r.submittedAt >= prev.submittedAt) latest.set(r.author, r);
  }
  const changesRequestedBy = [...latest.values()]
    .filter((r) => r.state === 'CHANGES_REQUESTED')
    .map((r) => r.author);

  return { reviews, threads, openHumanThreads, changesRequestedBy };
}

/** One line for status/merge output, e.g. `2 open human thread(s) · changes requested by bob`. */
export function formatGhReviewLine(summary: GhReviewSummary): string {
  const parts: string[] = [];
  if (summary.openHumanThreads.length > 0) {
    const where = summary.openHumanThreads
      .map((t) => (t.line ? `${t.path}:${t.line}` : t.path))
      .join(', ');
    parts.push(
      `${summary.openHumanThreads.length} open human thread(s) (${where}) — resolve in the GitHub UI`
    );
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

/**
 * Internal: fetch a REST array, following pagination when gh supports `--slurp`
 * and falling back to the first page otherwise. `null` when the request fails.
 */
async function fetchRestArray(path: string, cwd: string): Promise<unknown | null> {
  try {
    const out = await runGh(['api', path, '--paginate', '--slurp'], cwd);
    const parsed = JSON.parse(out);
    if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
      return (parsed as unknown[][]).flat();
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    try {
      return JSON.parse(await runGh(['api', path], cwd));
    } catch {
      return null;
    }
  }
}

const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $pr: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes { isResolved isOutdated path line
          comments(first: 100) { nodes { author { login } body path line createdAt } } }
      }
    }
  }
}`;

/** Fetch reviews (REST) and review threads (GraphQL). `null` when either fetch fails. */
export async function fetchGhReviewSummary(
  repo: string,
  pr: number,
  prAuthor: string,
  cwd: string
): Promise<GhReviewSummary | null> {
  const [owner, name] = repo.split('/');
  if (!owner || !name) return null;

  const reviews = await fetchRestArray(`repos/${repo}/pulls/${pr}/reviews`, cwd);
  if (reviews === null) return null;

  let threads: unknown;
  try {
    const out = await runGh(
      [
        'api',
        'graphql',
        '-F',
        `owner=${owner}`,
        '-F',
        `name=${name}`,
        '-F',
        `pr=${pr}`,
        '-f',
        `query=${REVIEW_THREADS_QUERY}`,
      ],
      cwd
    );
    const parsed = JSON.parse(out) as any;
    threads = parsed?.data?.repository?.pullRequest?.reviewThreads?.nodes;
    if (!Array.isArray(threads)) return null;
  } catch {
    return null;
  }

  return summarizeGhReviews(reviews, threads, prAuthor);
}
