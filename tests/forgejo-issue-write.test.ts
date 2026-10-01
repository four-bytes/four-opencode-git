// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { forgejoIssueCreateTool } from '../src/tools/forgejo-issue-create';
import { forgejoIssueCommentTool } from '../src/tools/forgejo-issue-comment';
import {
  forgejoIssueCommentsTool,
  formatForgejoIssueComments,
} from '../src/tools/forgejo-issue-comments';
import {
  findLinkedPulls,
  forgejoIssueCloseTool,
  formatLinkedPulls,
} from '../src/tools/forgejo-issue-close';
import {
  forgejoApiAll,
  matchLabelIds,
  repoFromRemoteUrl,
  resolveLabelIds,
  splitLabels,
  summarizeBody,
} from '../src/lib/forgejo-utils';
import { API, ctx, exampleRepo, withForgejo } from './forgejo-helpers';

const REPO = exampleRepo();

const LABELS = [
  { id: 1, name: 'bug' },
  { id: 2, name: 'agent-code' },
  { id: 3, name: 'caught-dev' },
];

const labelRoutes = (req: { method: string; url: string }) => {
  if (req.method === 'GET' && req.url.startsWith(`${API}/labels`)) return { json: LABELS };
  if (req.method === 'GET' && req.url.includes('/orgs/acme/labels')) {
    return { json: [{ id: 9, name: 'spec-change' }] };
  }
  return undefined;
};

// ────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────

describe('matchLabelIds', () => {
  it('matches case-insensitively and reports unknown names', () => {
    expect(matchLabelIds(['Bug', 'nope', 'caught-dev'], LABELS)).toEqual({
      ids: [1, 3],
      unknown: ['nope'],
    });
  });

  it('prefers a repo label over an org label of the same name', () => {
    expect(matchLabelIds(['bug'], [{ id: 1, name: 'bug' }, { id: 50, name: 'bug' }]).ids).toEqual([1]);
  });
});

describe('splitLabels / summarizeBody', () => {
  it('splits and trims comma lists', () => {
    expect(splitLabels(' bug, agent-code ,,')).toEqual(['bug', 'agent-code']);
    expect(splitLabels(undefined)).toEqual([]);
  });

  it('keeps the first line and counts the rest', () => {
    expect(summarizeBody('one\ntwo\nthree')).toBe('one (+2 lines)');
    expect(summarizeBody('x'.repeat(120), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

// ────────────────────────────────────────────────────────────────
// forgejo_issue_create
// ────────────────────────────────────────────────────────────────

describe('forgejo_issue_create', () => {
  it('creates with resolved label ids in one POST', async () => {
    await withForgejo(
      (req) =>
        labelRoutes(req) ??
        (req.method === 'POST' && req.url === `${API}/issues`
          ? { status: 201, json: { number: 42, title: req.body.title, html_url: `${API}/issues/42` } }
          : undefined),
      async (calls) => {
        const out = await forgejoIssueCreateTool.execute(
          { title: '[FIX] thing', body: 'b', labels: 'bug,agent-code,spec-change' },
          ctx(REPO)
        );
        expect(out).toContain('✓ Created #42 [bug, agent-code, spec-change] [FIX] thing');
        const posts = calls.filter((c) => c.method === 'POST');
        expect(posts).toHaveLength(1);
        expect(posts[0]!.body).toEqual({ title: '[FIX] thing', body: 'b', labels: [1, 2, 9] });
      }
    );
  });

  it('creates nothing when a label is unknown', async () => {
    await withForgejo(labelRoutes, async (calls) => {
      const out = await forgejoIssueCreateTool.execute(
        { title: '[FIX] thing', labels: 'bug,hit-prod' },
        ctx(REPO)
      );
      expect(out).toContain('unknown label(s) in acme/widgets: hit-prod');
      expect(calls.some((c) => c.method === 'POST')).toBe(false);
    });
  });

  it('skips the label lookup without labels', async () => {
    await withForgejo(
      (req) => (req.method === 'POST' ? { status: 201, json: { number: 1, title: 't' } } : undefined),
      async (calls) => {
        await forgejoIssueCreateTool.execute({ title: 't' }, ctx(REPO));
        expect(calls.map((c) => c.method)).toEqual(['POST']);
        expect(calls[0]!.body.labels).toBeUndefined();
      }
    );
  });

  it('returns the not-configured line without a token', async () => {
    const out = await forgejoIssueCreateTool.execute({ title: 't' }, ctx(REPO));
    expect(out).toContain('No Forgejo token for forgejo.example.com');
  });
});

// ────────────────────────────────────────────────────────────────
// forgejo_issue_comment / forgejo_issue_comments
// ────────────────────────────────────────────────────────────────

describe('forgejo_issue_comment', () => {
  it('sends shell metacharacters verbatim', async () => {
    const text = 'Fixed in `abc123` — $(rm -rf /) "quoted"';
    await withForgejo(
      (req) =>
        req.method === 'POST' && req.url === `${API}/issues/7/comments`
          ? { status: 201, json: { html_url: `${API}/issues/7#c1` } }
          : undefined,
      async (calls) => {
        const out = await forgejoIssueCommentTool.execute({ issue: 7, body: text }, ctx(REPO));
        expect(out).toContain('✓ Comment posted on #7');
        expect(calls[0]!.body).toEqual({ body: text });
      }
    );
  });

  it('refuses an empty comment without a request', async () => {
    await withForgejo(() => undefined, async (calls) => {
      expect(await forgejoIssueCommentTool.execute({ issue: 7, body: '  ' }, ctx(REPO))).toContain(
        'must not be empty'
      );
      expect(calls).toHaveLength(0);
    });
  });
});

describe('forgejo_issue_comments', () => {
  const COMMENTS = [
    { user: { login: 'alice' }, created_at: '2026-06-01T10:00:00Z', body: 'first\nmore' },
    { user: { login: 'bob' }, created_at: '2026-06-02T10:00:00Z', body: 'second' },
    { user: { login: 'carol' }, created_at: '2026-06-03T10:00:00Z', body: 'third' },
  ];

  it('formats one line per comment, newest N', () => {
    expect(formatForgejoIssueComments(COMMENTS, 5, 2)).toBe(
      [
        'FORGEJO COMMENTS — #5 — last 2 of 3',
        '',
        '  2026-06-02 bob: second',
        '  2026-06-03 carol: third',
      ].join('\n')
    );
    expect(formatForgejoIssueComments(COMMENTS, 5, 10)).toContain('alice: first (+1 lines)');
    expect(formatForgejoIssueComments([], 5, 10)).toBe('FORGEJO COMMENTS — #5 — none');
  });

  it('reads the comment list in one request', async () => {
    await withForgejo(
      (req) => (req.url === `${API}/issues/5/comments` ? { json: COMMENTS } : undefined),
      async (calls) => {
        const out = await forgejoIssueCommentsTool.execute({ issue: 5 }, ctx(REPO));
        expect(out).toContain('FORGEJO COMMENTS — #5 — 3');
        expect(calls).toHaveLength(1);
      }
    );
  });
});

// ────────────────────────────────────────────────────────────────
// forgejo_issue_close — zombie check
// ────────────────────────────────────────────────────────────────

describe('findLinkedPulls / formatLinkedPulls', () => {
  const PULLS = [
    { number: 10, title: 'feat: a (#12)', body: '', state: 'closed', merged: true },
    { number: 11, title: 'other', body: 'Closes #12', state: 'open', merged: false },
    { number: 13, title: 'feat: b (#123)', body: 'Fixes #120', state: 'closed', merged: true },
  ];

  it('matches title refs and closing keywords, not longer numbers', () => {
    expect(findLinkedPulls(PULLS, 12).map((p) => p.number)).toEqual([10, 11]);
  });

  it('describes merged, unmerged and missing links', () => {
    expect(formatLinkedPulls(12, findLinkedPulls(PULLS, 12))).toBe('✓ Referenced by merged PR !10.');
    expect(formatLinkedPulls(12, [{ number: 11, state: 'open', merged: false }])).toContain(
      'No merged PR for #12 — referenced by !11 (open)'
    );
    expect(formatLinkedPulls(99, [])).toContain('No PR references #99');
    expect(formatLinkedPulls(99, undefined)).toContain('Could not check');
  });
});

describe('forgejo_issue_close', () => {
  it('closes without a comment and reports the linked PR', async () => {
    await withForgejo(
      (req) => {
        if (req.method === 'GET' && req.url === `${API}/issues/12`) {
          return { json: { title: 'T', state: 'open' } };
        }
        if (req.method === 'PATCH') return { json: { state: 'closed' } };
        if (req.method === 'GET' && req.url.startsWith(`${API}/pulls`)) {
          return { json: [{ number: 10, title: 'feat (#12)', body: '', state: 'closed', merged: true }] };
        }
        return undefined;
      },
      async (calls) => {
        const out = await forgejoIssueCloseTool.execute({ issue: 12 }, ctx(REPO));
        expect(out).toContain('✓ Issue #12 "T" closed.');
        expect(out).toContain('✓ Referenced by merged PR !10.');
        expect(calls.some((c) => c.url.endsWith('/comments'))).toBe(false);
      }
    );
  });
});

describe('repoFromRemoteUrl', () => {
  it('takes owner/repo from https, ssh and scp-style remotes', () => {
    expect(repoFromRemoteUrl('https://forgejo.example.com/acme/widgets.git')).toBe('acme/widgets');
    expect(repoFromRemoteUrl('https://user:pw@forgejo.example.com/acme/widgets')).toBe('acme/widgets');
    expect(repoFromRemoteUrl('ssh://git@forgejo.example.com:2222/acme/widgets.git')).toBe('acme/widgets');
    expect(repoFromRemoteUrl('git@forgejo.example.com:acme/widgets.git')).toBe('acme/widgets');
    expect(repoFromRemoteUrl('https://example.com/forgejo/acme/my.repo.git')).toBe('acme/my.repo');
  });

  it('returns null without owner and repo', () => {
    expect(repoFromRemoteUrl('https://forgejo.example.com/')).toBeNull();
    expect(repoFromRemoteUrl('not-a-url')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// Error paths, pagination, not-configured
// ────────────────────────────────────────────────────────────────

describe('forgejoApiAll', () => {
  const item = (i: number) => ({ id: i, name: `l${i}` });

  it('walks pages until a short page', async () => {
    await withForgejo(
      (req) => {
        const page = Number(new URL(req.url).searchParams.get('page'));
        const size = page === 1 ? 50 : 3;
        return { json: Array.from({ length: size }, (_, i) => item(page * 100 + i)) };
      },
      async (calls) => {
        const result = await forgejoApiAll(`${'/repos/acme/widgets/labels'}`, {
          token: 't',
          host: 'https://forgejo.example.com',
        });
        expect(result.ok).toBe(true);
        expect(result.data).toHaveLength(53);
        expect(calls).toHaveLength(2);
        expect(calls[0]!.url).toContain('limit=50&page=1');
      }
    );
  });

  it('fails the whole call when a later page fails', async () => {
    await withForgejo(
      (req) =>
        req.url.includes('page=1')
          ? { json: Array.from({ length: 50 }, (_, i) => item(i)) }
          : { status: 500, json: { message: 'boom' } },
      async () => {
        const result = await forgejoApiAll('/repos/acme/widgets/labels', {
          token: 't',
          host: 'https://forgejo.example.com',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('page 2: boom');
      }
    );
  });
});

describe('resolveLabelIds — org labels', () => {
  const config = { token: 't', host: 'https://forgejo.example.com' };

  it('treats a 404 on org labels as "no org"', async () => {
    await withForgejo(
      (req) => (req.url.includes('/repos/acme/widgets/labels') ? { json: LABELS } : undefined),
      async () => {
        expect(await resolveLabelIds('acme/widgets', ['bug'], config)).toEqual({ ids: [1], unknown: [] });
      }
    );
  });

  it('surfaces any other org-label failure instead of calling labels unknown', async () => {
    await withForgejo(
      (req) =>
        req.url.includes('/repos/acme/widgets/labels')
          ? { json: LABELS }
          : { status: 403, json: { message: 'forbidden' } },
      async () => {
        const res = await resolveLabelIds('acme/widgets', ['spec-change'], config);
        expect(res.error).toBe('org labels: forbidden');
      }
    );
  });
});

describe('API error paths', () => {
  const fail500 = () => ({ status: 500, json: { message: 'server error' } });

  it('create reports a failed POST', async () => {
    await withForgejo(fail500, async () => {
      expect(await forgejoIssueCreateTool.execute({ title: 't' }, ctx(REPO))).toBe(
        'Error creating issue: server error'
      );
    });
  });

  it('comment and comments report failures', async () => {
    await withForgejo(fail500, async () => {
      expect(await forgejoIssueCommentTool.execute({ issue: 3, body: 'x' }, ctx(REPO))).toBe(
        'Error commenting on #3: server error'
      );
      expect(await forgejoIssueCommentsTool.execute({ issue: 3 }, ctx(REPO))).toBe(
        'Error reading comments on #3: server error'
      );
    });
  });

  it('close posts the comment first, then closes', async () => {
    await withForgejo(
      (req) => {
        if (req.method === 'GET' && req.url === `${API}/issues/12`) return { json: { title: 'T', state: 'open' } };
        if (req.method === 'POST') return { status: 201, json: {} };
        if (req.method === 'PATCH') return { json: { state: 'closed' } };
        if (req.url.startsWith(`${API}/pulls`)) return { json: [] };
        return undefined;
      },
      async (calls) => {
        const out = await forgejoIssueCloseTool.execute({ issue: 12, comment: 'done `x`' }, ctx(REPO));
        expect(out).toContain('✓ Comment posted on #12');
        expect(out).toContain('No PR references #12');
        const writes = calls.filter((c) => c.method !== 'GET');
        expect(writes.map((c) => c.method)).toEqual(['POST', 'PATCH']);
        expect(writes[0]!.body).toEqual({ body: 'done `x`' });
      }
    );
  });
});

describe('not configured', () => {
  it('every new tool returns the one-line message and makes no request', async () => {
    const realFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('null');
    }) as unknown as typeof fetch;
    try {
      const outs = [
        await forgejoIssueCreateTool.execute({ title: 't' }, ctx(REPO)),
        await forgejoIssueCommentTool.execute({ issue: 1, body: 'x' }, ctx(REPO)),
        await forgejoIssueCommentsTool.execute({ issue: 1 }, ctx(REPO)),
        await forgejoIssueCloseTool.execute({ issue: 1 }, ctx(REPO)),
      ];
      for (const out of outs) expect(out).toContain('No Forgejo token for forgejo.example.com');
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
