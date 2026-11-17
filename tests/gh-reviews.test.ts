// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, expect, test } from 'bun:test';
import { summarizeGhReviews, isBotLogin, formatGhReviewLine } from '../src/lib/gh-reviews';
import { formatGhPrComments } from '../src/tools/gh-pr-comments';

const AUTHOR = 'erin';

const review = (login: string, state: string, submitted_at: string, body = '') => ({
  user: { login },
  state,
  body,
  submitted_at,
});

const thread = (
  opts: {
    isResolved?: boolean;
    isOutdated?: boolean;
    path?: string;
    line?: number | null;
    comments: Array<{ login: string; body?: string; path?: string; line?: number | null; createdAt?: string }>;
  }
) => ({
  isResolved: opts.isResolved ?? false,
  isOutdated: opts.isOutdated ?? false,
  path: opts.path,
  line: opts.line,
  comments: {
    nodes: opts.comments.map((c) => ({
      author: { login: c.login },
      body: c.body ?? 'comment',
      path: c.path ?? opts.path,
      line: c.line === undefined ? (opts.line ?? null) : c.line,
      createdAt: c.createdAt ?? '2026-01-02T10:00:00Z',
    })),
  },
});

describe('isBotLogin', () => {
  test('detects bot logins', () => {
    expect(isBotLogin('coderabbitai[bot]')).toBe(true);
    expect(isBotLogin('renovate-bot')).toBe(true);
    expect(isBotLogin('ci_bot')).toBe(true);
    expect(isBotLogin('bot')).toBe(true);
  });

  test('keeps humans', () => {
    expect(isBotLogin('bob')).toBe(false);
    expect(isBotLogin('abbot')).toBe(false);
  });
});

describe('summarizeGhReviews', () => {
  test('maps reviews and flags dismissed ones as inactive', () => {
    const summary = summarizeGhReviews(
      [
        review('alice', 'APPROVED', '2026-01-01T10:00:00Z'),
        review('dave', 'DISMISSED', '2026-01-02T10:00:00Z', 'stale'),
      ],
      [],
      AUTHOR
    );

    expect(summary.reviews).toHaveLength(2);
    expect(summary.reviews[0]).toMatchObject({
      author: 'alice',
      state: 'APPROVED',
      dismissed: false,
      active: true,
      bot: false,
    });
    expect(summary.reviews[1]).toMatchObject({ author: 'dave', dismissed: true, active: false });
  });

  test('latest active verdict per human decides changes requested', () => {
    const summary = summarizeGhReviews(
      [
        review('alice', 'CHANGES_REQUESTED', '2026-01-01T10:00:00Z'),
        review('bob', 'CHANGES_REQUESTED', '2026-01-01T10:00:00Z'),
        review('bob', 'APPROVED', '2026-01-03T10:00:00Z'),
        review('coderabbitai[bot]', 'CHANGES_REQUESTED', '2026-01-04T10:00:00Z'),
        review('dave', 'DISMISSED', '2026-01-04T10:00:00Z'),
        review(AUTHOR, 'CHANGES_REQUESTED', '2026-01-04T10:00:00Z'),
      ],
      [],
      AUTHOR
    );

    expect(summary.changesRequestedBy).toEqual(['alice']);
  });

  test('detects open human threads: unresolved + human non-author comment', () => {
    const summary = summarizeGhReviews(
      [],
      [
        // open: unresolved, human reviewer comment
        thread({
          path: 'src/a.ts',
          line: 12,
          comments: [{ login: 'bob', body: 'Fix this' }],
        }),
        // resolved → closed
        thread({
          isResolved: true,
          path: 'src/b.ts',
          line: 3,
          comments: [{ login: 'bob' }],
        }),
        // bot only → advisory, never blocks
        thread({
          path: 'src/c.ts',
          line: 7,
          comments: [{ login: 'coderabbitai[bot]' }],
        }),
        // author only → not a human thread
        thread({
          path: 'src/d.ts',
          line: null,
          comments: [{ login: AUTHOR }],
        }),
      ],
      AUTHOR
    );

    expect(summary.openHumanThreads.map((t) => t.key)).toEqual(['src/a.ts:12']);
  });

  test('falls back to the first comment for thread path/line', () => {
    const summary = summarizeGhReviews(
      [],
      [
        {
          isResolved: false,
          isOutdated: true,
          comments: {
            nodes: [
              {
                author: { login: 'bob' },
                body: 'here',
                path: 'src/e.ts',
                line: 42,
                createdAt: '2026-01-02T10:00:00Z',
              },
            ],
          },
        },
      ],
      AUTHOR
    );

    const t = summary.threads[0]!;
    expect(t.path).toBe('src/e.ts');
    expect(t.line).toBe(42);
    expect(t.outdated).toBe(true);
    expect(t.key).toBe('src/e.ts:42');
    expect(t.comments[0]).toMatchObject({ author: 'bob', bot: false, path: 'src/e.ts', line: 42 });
  });
});

describe('formatGhReviewLine', () => {
  test('reports open threads and changes requested', () => {
    const summary = summarizeGhReviews(
      [review('alice', 'CHANGES_REQUESTED', '2026-01-01T10:00:00Z')],
      [thread({ path: 'src/a.ts', line: 12, comments: [{ login: 'bob' }] })],
      AUTHOR
    );
    expect(formatGhReviewLine(summary)).toBe(
      '1 open human thread(s) (src/a.ts:12) — resolve in the GitHub UI · changes requested by alice'
    );
  });

  test('reports approval when nothing blocks', () => {
    const summary = summarizeGhReviews(
      [review('alice', 'APPROVED', '2026-01-01T10:00:00Z')],
      [],
      AUTHOR
    );
    expect(formatGhReviewLine(summary)).toBe('no open human threads · approved by alice');
  });
});

describe('formatGhPrComments', () => {
  test('renders header, thread line and time-ordered one-line entries', () => {
    const conversation = [
      {
        user: { login: 'frank' },
        body: 'Looks good overall\nsecond line',
        created_at: '2026-01-05T09:00:00Z',
      },
    ];
    const summary = summarizeGhReviews(
      [
        review('alice', 'APPROVED', '2026-01-01T10:00:00Z', ''),
        review('bob', 'CHANGES_REQUESTED', '2026-01-02T10:00:00Z', 'Please fix\nmore detail'),
        review('zoe', 'PENDING', '2026-01-06T10:00:00Z'),
        review('dave', 'DISMISSED', '2026-01-06T11:00:00Z', 'ignored'),
      ],
      [
        thread({
          path: 'src/a.ts',
          line: 12,
          comments: [{ login: 'bob', body: 'Fix this', createdAt: '2026-01-03T10:00:00Z' }],
        }),
        thread({
          isResolved: true,
          path: 'src/b.ts',
          line: 3,
          comments: [{ login: 'bob', body: 'Done', createdAt: '2026-01-04T10:00:00Z' }],
        }),
      ],
      AUTHOR
    );

    const out = formatGhPrComments(9, conversation, summary, 20);
    const lines = out.split('\n');

    expect(lines[0]).toBe('GH PR #9 — 5 comment(s)');
    expect(lines[1]).toBe(
      '  threads   1 open human thread(s) (src/a.ts:12) — resolve in the GitHub UI · changes requested by bob'
    );
    expect(out).toContain('2026-01-01 alice APPROVED');
    expect(out).toContain('2026-01-02 bob CHANGES_REQUESTED: Please fix (+1 lines)');
    expect(out).toContain('2026-01-03 bob OPEN src/a.ts:12: Fix this');
    expect(out).toContain('2026-01-04 bob resolved src/b.ts:3: Done');
    expect(out).toContain('2026-01-05 frank: Looks good overall (+1 lines)');
    // PENDING and DISMISSED reviews are skipped entirely.
    expect(out).not.toContain('zoe');
    expect(out).not.toContain('dave');
  });

  test('limits to the most recent entries and reports the slice', () => {
    const conversation = [
      { user: { login: 'frank' }, body: 'first', created_at: '2026-01-01T09:00:00Z' },
      { user: { login: 'frank' }, body: 'second', created_at: '2026-01-02T09:00:00Z' },
    ];
    const summary = summarizeGhReviews([], [], AUTHOR);

    const out = formatGhPrComments(1, conversation, summary, 1);
    expect(out.split('\n')[0]).toBe('GH PR #1 — last 1 of 2 comment(s)');
    expect(out).toContain('second');
    expect(out).not.toContain('first');
  });
});
