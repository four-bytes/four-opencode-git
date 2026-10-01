// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { blocksMerge, formatReviewLine, isBotLogin, summarizeReviews } from '../src/lib/forgejo-reviews';
import { forgejoPrCreateTool } from '../src/tools/forgejo-pr-create';
import { forgejoPrMergeTool, formatMergeError, preMergeRefusal } from '../src/tools/forgejo-pr-merge';
import { forgejoPrCloseTool } from '../src/tools/forgejo-pr-close';
import { forgejoPrCommentsTool } from '../src/tools/forgejo-pr-comments';
import { forgejoPrStatusTool, formatForgejoPrStatus } from '../src/tools/forgejo-pr-status';
import { API, ctx, exampleRepo, withForgejo, type Recorded } from './forgejo-helpers';

const REPO = exampleRepo();

const OPEN_PR = {
  number: 20,
  title: 'feat: thing (#17)',
  body: 'Closes #17',
  state: 'open',
  merged: false,
  mergeable: true,
  user: { login: 'author' },
  head: { ref: 'feat/17-thing', sha: 'abcdef1234567890' },
  base: { ref: 'main' },
};

// Reviews: one bot finding (open), one human approval.
const REVIEWS_CLEAN = [
  { id: 1, user: { login: 'coderabbitai[bot]' }, state: 'COMMENT', comments_count: 1, submitted_at: '2026-06-01T00:00:00Z' },
  { id: 2, user: { login: 'carol' }, state: 'APPROVED', comments_count: 0, submitted_at: '2026-06-02T00:00:00Z' },
];
const BOT_COMMENTS = [{ id: 11, user: { login: 'coderabbitai[bot]' }, path: 'a.ts', position: 3, body: 'nit', resolver: null }];

/** Route table for a PR with the given reviews and review comments. */
function prRoutes(pr: any, reviews: any[], commentsByReview: Record<number, any[]>) {
  return (req: Recorded) => {
    if (req.method === 'GET' && req.url === `${API}/pulls/${pr.number}`) return { json: pr };
    if (req.method === 'GET' && req.url.startsWith(`${API}/pulls/${pr.number}/reviews?`)) return { json: reviews };
    const m = req.url.match(/\/reviews\/(\d+)\/comments$/);
    if (req.method === 'GET' && m) return { json: commentsByReview[Number(m[1])] ?? [] };
    if (req.method === 'GET' && req.url === `${API}/issues/${pr.number}/comments`) return { json: [] };
    return undefined;
  };
}

// ────────────────────────────────────────────────────────────────
// Review analysis (pure)
// ────────────────────────────────────────────────────────────────

describe('isBotLogin', () => {
  it('recognises bot logins without catching human names', () => {
    for (const bot of ['coderabbitai[bot]', 'renovate-bot', 'ci_bot', 'bot']) expect(isBotLogin(bot)).toBe(true);
    for (const human of ['abbot', 'talbot', 'robby']) expect(isBotLogin(human)).toBe(false);
  });
});

describe('summarizeReviews', () => {
  it('does not block on bot findings or approvals', () => {
    const s = summarizeReviews(REVIEWS_CLEAN, { 1: BOT_COMMENTS }, 'author');
    expect(blocksMerge(s)).toBe(false);
    expect(formatReviewLine(s)).toBe('no open human threads · approved by carol');
  });

  it('blocks on an unresolved human inline comment', () => {
    const s = summarizeReviews(
      [{ id: 3, user: { login: 'bob' }, state: 'COMMENT', comments_count: 1 }],
      { 3: [{ id: 30, user: { login: 'bob' }, path: 'x.ts', position: 9, body: 'why?', resolver: null }] },
      'author'
    );
    expect(blocksMerge(s)).toBe(true);
    expect(formatReviewLine(s)).toBe('1 open human thread(s) (x.ts:9) — resolve in the Forgejo UI');
  });

  it('treats a conversation as resolved when its root comment is', () => {
    // Forgejo sets `resolver` on the root only; a later reply by the reviewer has none.
    const s = summarizeReviews(
      [
        { id: 3, user: { login: 'bob' }, state: 'COMMENT', comments_count: 1 },
        { id: 4, user: { login: 'bob' }, state: 'COMMENT', comments_count: 1 },
      ],
      {
        3: [{ id: 30, user: { login: 'bob' }, path: 'x.ts', position: 9, body: 'why?', resolver: { login: 'bob' } }],
        4: [{ id: 40, user: { login: 'bob' }, path: 'x.ts', position: 9, body: 'ok, thanks', resolver: null }],
      },
      'author'
    );
    expect(s.conversations).toHaveLength(1);
    expect(blocksMerge(s)).toBe(false);
  });

  it('ignores comments of dismissed reviews', () => {
    const s = summarizeReviews(
      [{ id: 3, user: { login: 'bob' }, state: 'COMMENT', dismissed: true, comments_count: 1 }],
      { 3: [{ id: 30, user: { login: 'bob' }, path: 'x.ts', position: 9, body: 'why?', resolver: null }] },
      'author'
    );
    expect(blocksMerge(s)).toBe(false);
  });

  it('ignores resolved comments and the author\'s own', () => {
    const s = summarizeReviews(
      [{ id: 3, user: { login: 'bob' }, state: 'COMMENT', comments_count: 2 }],
      {
        3: [
          { id: 30, user: { login: 'bob' }, body: 'x', resolver: { login: 'bob' } },
          { id: 31, user: { login: 'author' }, body: 'reply', resolver: null },
        ],
      },
      'author'
    );
    expect(blocksMerge(s)).toBe(false);
  });

  it('uses the latest active verdict per reviewer', () => {
    const changes = { id: 4, user: { login: 'bob' }, state: 'REQUEST_CHANGES', submitted_at: '2026-06-01T00:00:00Z' };
    expect(summarizeReviews([changes], {}, 'author').changesRequestedBy).toEqual(['bob']);
    const approvedLater = { id: 5, user: { login: 'bob' }, state: 'APPROVED', submitted_at: '2026-06-03T00:00:00Z' };
    expect(summarizeReviews([changes, approvedLater], {}, 'author').changesRequestedBy).toEqual([]);
    const dismissed = { ...changes, dismissed: true };
    expect(summarizeReviews([dismissed], {}, 'author').changesRequestedBy).toEqual([]);
  });
});

describe('preMergeRefusal / formatMergeError', () => {
  it('refuses merged, closed and unmergeable PRs', () => {
    expect(preMergeRefusal(OPEN_PR)).toBeNull();
    expect(preMergeRefusal({ ...OPEN_PR, merged: true, state: 'closed' })).toContain('already merged');
    expect(preMergeRefusal({ ...OPEN_PR, state: 'closed' })).toContain('is closed');
    expect(preMergeRefusal({ ...OPEN_PR, mergeable: false })).toContain('not mergeable');
  });

  it('maps 405 and 409 to readable reasons', () => {
    expect(formatMergeError(20, 'squash', 405, 'not allowed')).toContain('allows "squash" merges');
    expect(formatMergeError(20, 'squash', 409, 'conflict')).toContain('conflicted (409: conflict)');
    expect(formatMergeError(20, 'squash', 500)).toBe('✗ Merge of !20 failed (HTTP 500).');
  });
});

// ────────────────────────────────────────────────────────────────
// forgejo_pr_merge
// ────────────────────────────────────────────────────────────────

describe('forgejo_pr_merge', () => {
  it('squash-merges with branch deletion and reports the merge commit', async () => {
    let merged = false;
    const base = prRoutes(OPEN_PR, REVIEWS_CLEAN, { 1: BOT_COMMENTS });
    await withForgejo(
      (req) => {
        if (req.method === 'POST' && req.url === `${API}/pulls/20/merge`) {
          merged = true;
          return { json: null };
        }
        if (merged && req.url === `${API}/pulls/20`) {
          return { json: { ...OPEN_PR, state: 'closed', merged: true, merge_commit_sha: '1234567890abcdef' } };
        }
        return base(req);
      },
      async (calls) => {
        const out = await forgejoPrMergeTool.execute({ pr: 20 }, ctx(REPO));
        expect(out).toContain('✓ PR !20 merged via squash (12345678) into main');
        expect(out).toContain('git branch -D feat/17-thing');
        const post = calls.find((c) => c.method === 'POST')!;
        expect(post.body).toEqual({
          Do: 'squash',
          MergeTitleField: 'feat: thing (#17)',
          MergeMessageField: 'Closes #17',
          delete_branch_after_merge: true,
          head_commit_id: 'abcdef1234567890',
        });
      }
    );
  });

  const noMergeCall = (calls: Recorded[]) => expect(calls.some((c) => c.url.endsWith('/merge'))).toBe(false);

  it('refuses with an open human thread — no merge call', async () => {
    const reviews = [{ id: 3, user: { login: 'bob' }, state: 'COMMENT', comments_count: 1 }];
    const comments = { 3: [{ id: 30, user: { login: 'bob' }, path: 'x.ts', body: '?', resolver: null }] };
    await withForgejo(prRoutes(OPEN_PR, reviews, comments), async (calls) => {
      expect(await forgejoPrMergeTool.execute({ pr: 20 }, ctx(REPO))).toBe(
        '✗ PR !20 not merged: 1 open human thread(s) (x.ts) — resolve in the Forgejo UI.'
      );
      noMergeCall(calls);
    });
  });

  it('refuses when a human requested changes — no merge call', async () => {
    const reviews = [{ id: 4, user: { login: 'bob' }, state: 'REQUEST_CHANGES', comments_count: 0, submitted_at: '2026-06-02T00:00:00Z' }];
    await withForgejo(prRoutes(OPEN_PR, reviews, {}), async (calls) => {
      expect(await forgejoPrMergeTool.execute({ pr: 20 }, ctx(REPO))).toBe(
        '✗ PR !20 not merged: changes requested by bob.'
      );
      noMergeCall(calls);
    });
  });

  it('refuses without a head commit — no merge call', async () => {
    await withForgejo(prRoutes({ ...OPEN_PR, head: { ref: 'x' } }, [], {}), async (calls) => {
      expect(await forgejoPrMergeTool.execute({ pr: 20 }, ctx(REPO))).toContain('no head commit');
      noMergeCall(calls);
    });
  });

  it('maps a 409 from the merge endpoint', async () => {
    const base = prRoutes(OPEN_PR, [], {});
    await withForgejo(
      (req) => (req.url.endsWith('/merge') ? { status: 409, json: { message: 'head out of date' } } : base(req)),
      async () => {
        expect(await forgejoPrMergeTool.execute({ pr: 20 }, ctx(REPO))).toContain(
          'conflicted (409: head out of date)'
        );
      }
    );
  });

  it('refuses a conflicted or closed PR — no merge call', async () => {
    for (const pr of [{ ...OPEN_PR, mergeable: false }, { ...OPEN_PR, state: 'closed' }]) {
      await withForgejo(prRoutes(pr, [], {}), async (calls) => {
        expect(await forgejoPrMergeTool.execute({ pr: 20 }, ctx(REPO))).toContain('✗ PR !20');
        noMergeCall(calls);
      });
    }
  });

  it('refuses when reviews cannot be read', async () => {
    await withForgejo(
      (req) => (req.url === `${API}/pulls/20` ? { json: OPEN_PR } : { status: 500, json: { message: 'x' } }),
      async (calls) => {
        expect(await forgejoPrMergeTool.execute({ pr: 20 }, ctx(REPO))).toContain('Could not read reviews');
        noMergeCall(calls);
      }
    );
  });

  it('maps a 405 from the merge endpoint, never throws', async () => {
    const base = prRoutes(OPEN_PR, [], {});
    await withForgejo(
      (req) => (req.url.endsWith('/merge') ? { status: 405, json: { message: 'merge style not allowed' } } : base(req)),
      async () => {
        expect(await forgejoPrMergeTool.execute({ pr: 20, method: 'rebase' }, ctx(REPO))).toContain(
          'refused the merge of !20 (405: merge style not allowed)'
        );
      }
    );
  });
});

// ────────────────────────────────────────────────────────────────
// forgejo_pr_create / close / comments / status
// ────────────────────────────────────────────────────────────────

describe('forgejo_pr_create', () => {
  it('defaults base to the repo default branch', async () => {
    await withForgejo(
      (req) => {
        if (req.method === 'GET' && req.url === API) return { json: { default_branch: 'trunk' } };
        if (req.method === 'POST' && req.url === `${API}/pulls`) {
          return { status: 201, json: { number: 21, html_url: `${API}/pulls/21` } };
        }
        return undefined;
      },
      async (calls) => {
        const out = await forgejoPrCreateTool.execute(
          { title: 'feat: x (#17)', body: 'Closes #17', head: 'feat/17-x' },
          ctx(REPO)
        );
        expect(out).toContain('✓ Created PR !21 feat/17-x → trunk');
        expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
          title: 'feat: x (#17)',
          body: 'Closes #17',
          head: 'feat/17-x',
          base: 'trunk',
        });
      }
    );
  });

  it('hints at an existing PR on 409', async () => {
    await withForgejo(
      (req) => (req.method === 'POST' ? { status: 409, json: { message: 'exists' } } : undefined),
      async () => {
        expect(
          await forgejoPrCreateTool.execute({ title: 't', head: 'a', base: 'main' }, ctx(REPO))
        ).toContain('already exists?');
      }
    );
  });
});

describe('forgejo_pr_close', () => {
  it('comments, then closes without merging', async () => {
    const base = prRoutes(OPEN_PR, [], {});
    await withForgejo(
      (req) => (req.method === 'POST' ? { status: 201, json: {} } : req.method === 'PATCH' ? { json: {} } : base(req)),
      async (calls) => {
        const out = await forgejoPrCloseTool.execute({ pr: 20, comment: 'superseded by !22' }, ctx(REPO));
        expect(out).toContain('closed without merging');
        const writes = calls.filter((c) => c.method !== 'GET');
        expect(writes.map((c) => `${c.method} ${c.url.replace(API, '')}`)).toEqual([
          'POST /issues/20/comments',
          'PATCH /pulls/20',
        ]);
        expect(writes[1]!.body).toEqual({ state: 'closed' });
      }
    );
  });

  it('does nothing for a merged PR', async () => {
    await withForgejo(prRoutes({ ...OPEN_PR, state: 'closed', merged: true }, [], {}), async (calls) => {
      expect(await forgejoPrCloseTool.execute({ pr: 20 }, ctx(REPO))).toContain('already merged');
      expect(calls.every((c) => c.method === 'GET')).toBe(true);
    });
  });
});

describe('forgejo_pr_comments', () => {
  it('lists conversation, verdicts and inline comments, marking open human threads', async () => {
    const reviews = [{ id: 3, user: { login: 'bob' }, state: 'REQUEST_CHANGES', comments_count: 1, submitted_at: '2026-06-02T00:00:00Z', body: 'see inline' }];
    const comments = { 3: [{ id: 30, user: { login: 'bob' }, path: 'x.ts', position: 9, body: 'why?', resolver: null, created_at: '2026-06-02T00:00:01Z' }] };
    const base = prRoutes(OPEN_PR, reviews, comments);
    await withForgejo(
      (req) =>
        req.url === `${API}/issues/20/comments`
          ? { json: [{ user: { login: 'alice' }, created_at: '2026-06-01T00:00:00Z', body: 'looks good' }] }
          : base(req),
      async () => {
        const out = await forgejoPrCommentsTool.execute({ pr: 20 }, ctx(REPO));
        expect(out).toBe(
          [
            'FORGEJO PR !20 — 3 comment(s)',
            '  threads   1 open human thread(s) (x.ts:9) — resolve in the Forgejo UI · changes requested by bob',
            '',
            '  2026-06-01 alice: looks good',
            '  2026-06-02 bob REQUEST_CHANGES: see inline',
            '  2026-06-02 bob OPEN x.ts:9: why?',
          ].join('\n')
        );
      }
    );
  });
});

describe('forgejo_pr_status — threads', () => {
  it('adds the threads line for open PRs', async () => {
    await withForgejo(prRoutes(OPEN_PR, REVIEWS_CLEAN, { 1: BOT_COMMENTS }), async () => {
      const out = await forgejoPrStatusTool.execute({ pr: 20 }, ctx(REPO));
      expect(out).toContain('  merge     mergeable');
      expect(out).toContain('  threads   no open human threads · approved by carol');
    });
  });

  it('keeps the 4-line shape for closed PRs and flags unmergeable open ones', () => {
    const closed = formatForgejoPrStatus({ ...OPEN_PR, state: 'closed', merged: true, merge_commit_sha: 'ff' } as any, null);
    expect(closed.split('\n')).toHaveLength(4);
    expect(formatForgejoPrStatus({ ...OPEN_PR, mergeable: false } as any, null, 'x')).toContain('not mergeable');
    expect(formatForgejoPrStatus({ ...OPEN_PR, mergeable: undefined } as any, null)).toContain('merge     unknown');
  });
});

describe('not configured', () => {
  it('every PR tool returns the one-line message', async () => {
    const outs = [
      await forgejoPrCreateTool.execute({ title: 't', head: 'a', base: 'b' }, ctx(REPO)),
      await forgejoPrMergeTool.execute({ pr: 1 }, ctx(REPO)),
      await forgejoPrCloseTool.execute({ pr: 1 }, ctx(REPO)),
      await forgejoPrCommentsTool.execute({ pr: 1 }, ctx(REPO)),
    ];
    for (const out of outs) expect(out).toContain('No Forgejo token for forgejo.example.com');
  });
});
