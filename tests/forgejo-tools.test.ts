// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import {
  formatForgejoIssueList,
  normalizeForgejoIssueListItems,
} from '../src/tools/forgejo-issue-list';
import {
  formatForgejoIssueView,
  normalizeForgejoIssueView,
  truncateBody,
} from '../src/tools/forgejo-issue-view';
import { formatForgejoIssueClose } from '../src/tools/forgejo-issue-close';
import {
  formatForgejoPrStatus,
  pickContainingBranch,
  resolveStateLine,
  type ForgejoPull,
} from '../src/tools/forgejo-pr-status';
import { deriveHostFromRemoteUrl, getForgejoConfig } from '../src/lib/forgejo-utils';

/** Run `fn` with a temporary env overlay, restoring the previous values afterwards. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Unit tests — formatForgejoIssueList
// ────────────────────────────────────────────────────────────────

describe('formatForgejoIssueList', () => {
  it('formats one line per issue with labels', () => {
    // Fixture: GET /repos/scr/dev-playground/issues
    const issues = [
      {
        number: 1303,
        title: 'Add updated today/yesterday invoice filters',
        state: 'open',
        labels: ['spec-change'],
        assignees: ['robby'],
        html_url: 'https://git.4serv.de/scr/dev-playground/issues/1303',
        updated_at: '2026-06-10T12:00:00Z',
      },
      {
        number: 1302,
        title: 'Fix router null pointer',
        state: 'open',
        labels: ['bug', 'backend'],
        assignees: [],
        html_url: 'https://git.4serv.de/scr/dev-playground/issues/1302',
        updated_at: '2026-06-09T08:00:00Z',
      },
    ];

    const output = formatForgejoIssueList(issues, 'scr/dev-playground', 'open');
    expect(output).toContain(
      'FORGEJO ISSUE LIST — scr/dev-playground — 2 open issues'
    );
    expect(output).toContain('  #1303 [spec-change] Add updated today/yesterday invoice filters');
    expect(output).toContain('  #1302 [bug, backend] Fix router null pointer');
    // One line per issue — the header + blank + 2 issue lines.
    expect(output.split('\n')).toHaveLength(4);
  });

  it('handles an empty issue list', () => {
    const output = formatForgejoIssueList([], 'scr/dev-playground', 'open');
    expect(output).toContain('FORGEJO ISSUE LIST — scr/dev-playground');
    expect(output).toContain('no open issues found');
  });

  it('uses singular "issue" for a single result', () => {
    const issues = [
      {
        number: 1,
        title: 'Initial setup',
        state: 'closed',
        labels: [],
        assignees: [],
      },
    ];
    const output = formatForgejoIssueList(issues, 'scr/dev-playground', 'closed');
    expect(output).toMatch(/1 closed issue\b/);
  });

  it('omits label brackets when there are no labels', () => {
    const issues = [
      { number: 7, title: 'No labels here', state: 'open', labels: [], assignees: [] },
    ];
    const output = formatForgejoIssueList(issues, 'scr/dev-playground', 'open');
    expect(output).toContain('#7 No labels here');
    expect(output).not.toContain('[]');
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — truncateBody / formatForgejoIssueView
// ────────────────────────────────────────────────────────────────

describe('truncateBody', () => {
  it('returns short bodies unchanged', () => {
    expect(truncateBody('line1\nline2')).toBe('line1\nline2');
  });

  it('truncates to 20 lines with a marker', () => {
    const body = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n');
    const output = truncateBody(body);
    const lines = output.split('\n');
    expect(lines).toHaveLength(21);
    expect(lines[20]).toBe('… (5 more lines)');
  });

  it('handles empty body', () => {
    expect(truncateBody('')).toBe('');
  });
});

describe('formatForgejoIssueView', () => {
  it('formats full issue detail with a body', () => {
    // Fixture: GET /repos/scr/dev-playground/issues/1303
    const issue = {
      number: 1303,
      title: 'Add updated today/yesterday invoice filters',
      state: 'open',
      labels: ['spec-change'],
      assignees: ['robby'],
      body: '## Goal\n\nAdd filters.',
      comments: 3,
      html_url: 'https://git.4serv.de/scr/dev-playground/issues/1303',
    };

    const output = formatForgejoIssueView(issue, 'scr/dev-playground');
    expect(output).toContain('FORGEJO ISSUE #1303 — Add updated today/yesterday invoice filters');
    expect(output).toContain('repo       scr/dev-playground');
    expect(output).toContain('state      open');
    expect(output).toContain('labels     spec-change');
    expect(output).toContain('comments   3');
    expect(output).toContain('url        https://git.4serv.de/scr/dev-playground/issues/1303');
    expect(output).toContain('Add filters.');
  });

  it('shows a dash when there are no labels and omits an empty body', () => {
    const issue = {
      number: 9,
      title: 'Bare issue',
      state: 'closed',
      labels: [],
      assignees: [],
      body: '',
      comments: 0,
    };
    const output = formatForgejoIssueView(issue, 'scr/dev-playground');
    expect(output).toContain('labels     —');
    expect(output).toContain('comments   0');
    // No trailing blank line + body block when body is empty.
    expect(output.endsWith('comments   0')).toBe(true);
  });

  it('truncates a long body in the rendered output', () => {
    const issue = {
      number: 10,
      title: 'Long body',
      state: 'open',
      labels: ['x'],
      assignees: [],
      body: Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'),
      comments: 0,
    };
    const output = formatForgejoIssueView(issue, 'scr/dev-playground');
    expect(output).toContain('… (10 more lines)');
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — formatForgejoIssueClose
// ────────────────────────────────────────────────────────────────

describe('formatForgejoIssueClose', () => {
  it('reports an already-closed issue without doing anything', () => {
    const output = formatForgejoIssueClose({
      issue: 1303,
      title: 'Add filters',
      alreadyClosed: true,
      commentPosted: false,
      closed: false,
    });
    expect(output).toBe('Issue #1303 "Add filters" is already closed. Nothing to do.');
  });

  it('reports comment + close success', () => {
    const output = formatForgejoIssueClose({
      issue: 1303,
      title: 'Add filters',
      alreadyClosed: false,
      commentPosted: true,
      closed: true,
    });
    expect(output).toContain('✓ Comment posted on #1303');
    expect(output).toContain('✓ Issue #1303 "Add filters" closed.');
  });

  it('reports comment + close without a comment', () => {
    const output = formatForgejoIssueClose({
      issue: 55,
      title: 'No comment',
      alreadyClosed: false,
      commentPosted: false,
      closed: true,
    });
    expect(output).not.toContain('Comment posted');
    expect(output).toContain('✓ Issue #55 "No comment" closed.');
  });

  it('surfaces a comment failure but still closes', () => {
    const output = formatForgejoIssueClose({
      issue: 55,
      title: 'Comment fails',
      alreadyClosed: false,
      commentPosted: false,
      commentError: 'HTTP 403',
      closed: true,
    });
    expect(output).toContain('⚠ Failed to post comment: HTTP 403');
    expect(output).toContain('✓ Issue #55 "Comment fails" closed.');
  });

  it('surfaces a close failure', () => {
    const output = formatForgejoIssueClose({
      issue: 55,
      title: 'Close fails',
      alreadyClosed: false,
      commentPosted: true,
      closed: false,
      closeError: 'HTTP 500',
    });
    expect(output).toContain('✓ Comment posted on #55');
    expect(output).toContain('✗ Failed to close issue: HTTP 500');
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — pickContainingBranch
// ────────────────────────────────────────────────────────────────

describe('pickContainingBranch', () => {
  it('returns origin/<baseRef> when the remote default branch contains the commit', () => {
    const branches = ['  origin/feat/x', '  origin/main', '  origin/other'];
    expect(pickContainingBranch(branches, 'main')).toBe('origin/main');
  });

  it('returns null when only a non-default origin branch contains the commit', () => {
    // A commit reachable from some other branch was NOT merged into the default.
    const branches = ['  origin/feat/x', '  origin/release'];
    expect(pickContainingBranch(branches, 'main')).toBeNull();
  });

  it('returns null when baseRef is not among the remote branches', () => {
    const branches = ['  origin/main', '  origin/develop'];
    expect(pickContainingBranch(branches, 'release')).toBeNull();
  });

  it('ignores origin/HEAD symbolic-ref lines', () => {
    const branches = ['  origin/HEAD -> origin/main', '  origin/main'];
    expect(pickContainingBranch(branches, 'main')).toBe('origin/main');
  });

  it('returns null when nothing contains the commit', () => {
    expect(pickContainingBranch([''], 'main')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — formatForgejoPrStatus / resolveStateLine
// ────────────────────────────────────────────────────────────────

describe('formatForgejoPrStatus', () => {
  const basePr: ForgejoPull = {
    number: 1304,
    title: 'feat: add updated today/yesterday invoice filters (#1303)',
    state: 'open',
    merged: false,
    merge_commit_sha: null,
    head: { ref: 'feat/1303-updated-at-filters', sha: 'b22fbc09aabbccddeeff00112233445566778899' },
    base: { ref: 'main' },
    additions: 14,
    deletions: 0,
    comments: 0,
    html_url: 'https://git.4serv.de/scr/dev-playground/pulls/1304',
  };

  it('formats an open PR', () => {
    const output = formatForgejoPrStatus(basePr, null);
    expect(output).toContain('PR #1304 — feat: add updated today/yesterday invoice filters (#1303)');
    expect(output).toContain('state     open');
    expect(output).toContain('branch    feat/1303-updated-at-filters → main');
    expect(output).toContain('diff      +14 -0 · 0 comments');
    expect(output.split('\n')).toHaveLength(4);
  });

  it('formats a forge-side merged PR', () => {
    const pr: ForgejoPull = {
      ...basePr,
      state: 'closed',
      merged: true,
      merge_commit_sha: 'abc1234def567890',
    };
    const output = formatForgejoPrStatus(pr, null);
    expect(output).toContain('state     merged (abc1234d)');
  });

  it('formats a squash-merge detected via git as merged_via git-squash', () => {
    const pr: ForgejoPull = { ...basePr, state: 'closed', merged: false };
    const output = formatForgejoPrStatus(pr, {
      sha: 'b22fbc09aabbccddeeff00112233445566778899',
      branch: 'origin/main',
    });
    expect(output).toContain('state     closed · merged_via git-squash (b22fbc09 on origin/main)');
  });

  it('formats an abandoned closed PR when git finds no containing branch', () => {
    const pr: ForgejoPull = { ...basePr, state: 'closed', merged: false };
    const output = formatForgejoPrStatus(pr, null);
    expect(output).toContain('state     closed');
    expect(output).not.toContain('merged_via');
  });

  it('defaults missing diff counters to zero', () => {
    const pr: ForgejoPull = {
      ...basePr,
      additions: undefined,
      deletions: undefined,
      comments: undefined,
    };
    const output = formatForgejoPrStatus(pr, null);
    expect(output).toContain('diff      +0 -0 · 0 comments');
  });
});

describe('resolveStateLine', () => {
  const pr: ForgejoPull = {
    number: 1,
    title: 'x',
    state: 'closed',
    merged: false,
    head: { ref: 'a', sha: 'deadbeefdeadbeef' },
    base: { ref: 'main' },
  };

  it('distinguishes open, merged, squash-merged and abandoned', () => {
    expect(resolveStateLine({ ...pr, state: 'open' }, null)).toBe('open');
    expect(resolveStateLine({ ...pr, merged: true, merge_commit_sha: 'cafe1234' }, null)).toBe(
      'merged (cafe1234)'
    );
    expect(
      resolveStateLine(pr, { sha: 'deadbeefdeadbeef', branch: 'origin/main' })
    ).toBe('closed · merged_via git-squash (deadbeef on origin/main)');
    expect(resolveStateLine(pr, null)).toBe('closed');
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — raw API → normalized mapping
// ────────────────────────────────────────────────────────────────

describe('normalizeForgejoIssueListItems', () => {
  it('maps raw label/assignee objects to names', () => {
    // Fixture: raw GET /repos/{owner}/{repo}/issues response.
    const raw = [
      {
        number: 12,
        title: 'Raw shape',
        state: 'open',
        labels: [
          { id: 1, name: 'bug', color: '#ff0000' },
          { id: 2, name: 'backend', color: '#00ff00' },
        ],
        assignees: [{ id: 9, login: 'robby', full_name: 'Robby Beyer' }],
        html_url: 'https://git.4serv.de/scr/dev-playground/issues/12',
        updated_at: '2026-06-10T12:00:00Z',
      },
    ];

    const normalized = normalizeForgejoIssueListItems(raw);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]!.labels).toEqual(['bug', 'backend']);
    expect(normalized[0]!.assignees).toEqual(['robby']);
    expect(normalized[0]!.updated_at).toBe('2026-06-10T12:00:00Z');
  });

  it('accepts plain string labels/assignees', () => {
    const raw = [{ number: 1, title: 't', state: 'open', labels: ['x'], assignees: ['y'] }];
    const normalized = normalizeForgejoIssueListItems(raw);
    expect(normalized[0]!.labels).toEqual(['x']);
    expect(normalized[0]!.assignees).toEqual(['y']);
  });

  it('returns [] for a non-array payload', () => {
    expect(normalizeForgejoIssueListItems(null)).toEqual([]);
    expect(normalizeForgejoIssueListItems({ message: 'Not Found' })).toEqual([]);
  });
});

describe('normalizeForgejoIssueView', () => {
  it('maps raw API shape including numeric comments', () => {
    // Fixture: raw GET /repos/{owner}/{repo}/issues/{index} response.
    const raw = {
      number: 1303,
      title: 'Raw view',
      state: 'closed',
      labels: [{ id: 1, name: 'spec-change', color: '#abcdef' }],
      assignees: [{ id: 9, login: 'robby' }],
      body: 'hello world',
      comments: 7,
      html_url: 'https://git.4serv.de/scr/dev-playground/issues/1303',
    };

    const view = normalizeForgejoIssueView(raw);
    expect(view.labels).toEqual(['spec-change']);
    expect(view.assignees).toEqual(['robby']);
    expect(view.comments).toBe(7);
    expect(view.body).toBe('hello world');
    expect(view.state).toBe('closed');
  });

  it('honours a comment-count override when the list was fetched separately', () => {
    const view = normalizeForgejoIssueView(
      { number: 5, title: 't', state: 'open', labels: [], assignees: [] },
      3
    );
    expect(view.comments).toBe(3);
  });

  it('defaults comments to 0 and body to empty when absent', () => {
    const view = normalizeForgejoIssueView({ number: 5, labels: [], assignees: [] });
    expect(view.comments).toBe(0);
    expect(view.body).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — host derivation / config resolution (no live git)
// ────────────────────────────────────────────────────────────────

describe('deriveHostFromRemoteUrl', () => {
  it('extracts scheme+host from an https remote URL', () => {
    expect(deriveHostFromRemoteUrl('https://git.4serv.de/scr/dev-playground.git')).toBe(
      'https://git.4serv.de'
    );
  });

  it('extracts host from an ssh remote URL', () => {
    expect(deriveHostFromRemoteUrl('git@git.4serv.de:scr/dev-playground.git')).toBe(
      'https://git.4serv.de'
    );
  });

  it('returns null for an underivable URL', () => {
    expect(deriveHostFromRemoteUrl('not-a-url')).toBeNull();
    expect(deriveHostFromRemoteUrl('')).toBeNull();
  });
});

describe('getForgejoConfig', () => {
  it('uses FORGEJO_HOST when set', () => {
    withEnv({ FORGEJO_TOKEN: 'tok', FORGEJO_HOST: 'https://forge.example' }, () => {
      expect(getForgejoConfig()).toEqual({
        ok: true,
        config: { token: 'tok', host: 'https://forge.example' },
      });
    });
  });

  it('returns reason "host" when the token is present but no host is derivable', () => {
    // No cwd → remote is not consulted, and FORGEJO_HOST is unset → host absent.
    withEnv({ FORGEJO_TOKEN: 'tok', FORGEJO_HOST: undefined }, () => {
      expect(getForgejoConfig()).toEqual({ ok: false, reason: 'host' });
    });
  });

  it('returns reason "token" when FORGEJO_TOKEN is unset', () => {
    withEnv({ FORGEJO_TOKEN: undefined, FORGEJO_HOST: 'https://forge.example' }, () => {
      expect(getForgejoConfig()).toEqual({ ok: false, reason: 'token' });
    });
  });
});
