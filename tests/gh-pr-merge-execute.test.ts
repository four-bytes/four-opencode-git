// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock runGh so mergeGhPr's execute path can be driven without the gh CLI.
// mergeGhPr (gh-pr-merge.ts) and fetchGhReviewSummary (gh-reviews.ts) both
// import runGh from gh-utils, so one module mock covers both.
const runGhMock = mock();

mock.module('../src/lib/gh-utils', () => ({
  ...require('../src/lib/gh-utils'),
  runGh: runGhMock,
}));

import { mergeGhPr } from '../src/tools/gh-pr-merge';

const REPO = 'acme/widgets';
const PR_NUM = 7;

const PR_VIEW = JSON.stringify({
  number: PR_NUM,
  title: 'feat: thing (#6)',
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  url: `https://github.com/${REPO}/pull/${PR_NUM}`,
  baseRefName: 'main',
  headRefName: 'feat/6-thing',
  author: { login: 'author' },
});

const review = (login: string, state: string, submitted_at: string) => ({
  user: { login },
  state,
  body: '',
  submitted_at,
});

const thread = (opts: {
  isResolved?: boolean;
  path?: string;
  line?: number | null;
  comments: Array<{ login: string; body?: string; createdAt?: string }>;
}) => ({
  isResolved: opts.isResolved ?? false,
  isOutdated: false,
  path: opts.path,
  line: opts.line,
  comments: {
    nodes: opts.comments.map((c) => ({
      author: { login: c.login },
      body: c.body ?? 'comment',
      path: opts.path,
      line: opts.line === undefined ? (opts.line ?? null) : opts.line,
      createdAt: c.createdAt ?? '2026-01-02T10:00:00Z',
    })),
  },
});

const graphql = (threads: unknown[]) =>
  JSON.stringify({
    data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } },
  });

/**
 * Script the three gh calls mergeGhPr makes:
 *   1. `pr view`  → PR_VIEW
 *   2. REST reviews → reviews (JSON array string)
 *   3. GraphQL threads → threads
 * Optionally record `pr merge` invocations to assert the success path reaches it.
 */
function scriptRunGh(opts: {
  reviews?: unknown[];
  threads?: unknown[];
  failReviews?: boolean;
  onMerge?: (args: string[]) => void;
}): void {
  runGhMock.mockImplementation(async (args: string[]) => {
    const cmd = args[0];
    if (cmd === 'pr' && args[1] === 'view') return PR_VIEW;
    if (cmd === 'pr' && args[1] === 'merge') {
      opts.onMerge?.(args);
      return '';
    }
    if (cmd === 'api') {
      if (args[1] === 'graphql') return graphql(opts.threads ?? []);
      if (opts.failReviews) throw new Error('gh api failed');
      return JSON.stringify(opts.reviews ?? []);
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  });
}

beforeEach(() => {
  runGhMock.mockReset();
});

describe('mergeGhPr review-blocking (execute path)', () => {
  it('refuses when reviews cannot be read (summary null)', async () => {
    scriptRunGh({ failReviews: true });

    const output = await mergeGhPr(REPO, PR_NUM, 'squash', undefined, undefined, true, '/tmp');
    expect(output).toBe(`✗ Could not read reviews of PR #${PR_NUM} — not merged.`);
  });

  it('refuses on an open human thread', async () => {
    scriptRunGh({
      reviews: [],
      threads: [thread({ path: 'src/a.ts', line: 12, comments: [{ login: 'bob' }] })],
    });

    const output = await mergeGhPr(REPO, PR_NUM, 'squash', undefined, undefined, true, '/tmp');
    expect(output).toContain(`✗ PR #${PR_NUM} not merged:`);
    expect(output).toContain('open human thread(s) (src/a.ts:12)');
  });

  it('refuses when a human requested changes', async () => {
    scriptRunGh({
      reviews: [review('alice', 'CHANGES_REQUESTED', '2026-01-01T10:00:00Z')],
      threads: [],
    });

    const output = await mergeGhPr(REPO, PR_NUM, 'squash', undefined, undefined, true, '/tmp');
    expect(output).toContain(`✗ PR #${PR_NUM} not merged:`);
    expect(output).toContain('changes requested by alice');
  });

  it('does not block on bot-only findings and merges through', async () => {
    const merges: string[][] = [];
    scriptRunGh({
      reviews: [review('coderabbitai[bot]', 'CHANGES_REQUESTED', '2026-01-04T10:00:00Z')],
      threads: [thread({ path: 'src/c.ts', line: 7, comments: [{ login: 'coderabbitai[bot]' }] })],
      onMerge: (args) => merges.push(args),
    });

    const output = await mergeGhPr(REPO, PR_NUM, 'squash', undefined, undefined, true, '/tmp');
    expect(output).toContain(`✓ PR #${PR_NUM}`);
    expect(output).toContain('merged via squash');
    expect(merges).toHaveLength(1);
    expect(merges[0]).toContain('--squash');
  });

  it('does not block when the author is the only reviewer', async () => {
    const merges: string[][] = [];
    scriptRunGh({
      reviews: [review('author', 'CHANGES_REQUESTED', '2026-01-04T10:00:00Z')],
      threads: [thread({ path: 'src/d.ts', line: null, comments: [{ login: 'author' }] })],
      onMerge: (args) => merges.push(args),
    });

    const output = await mergeGhPr(REPO, PR_NUM, 'squash', undefined, undefined, true, '/tmp');
    expect(output).toContain('merged via squash');
    expect(merges).toHaveLength(1);
  });
});
