// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { afterAll, beforeAll, describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatGhIssueComments,
  forgeIssueCommentListTool,
} from '../src/tools/forge-issue-comment-list';
import { forgeIssueCommentCreateTool } from '../src/tools/forge-issue-comment-create';

const ctx = { directory: '/tmp', worktree: '/tmp', sessionID: 't', messageID: 't', agent: 't' };

let previousXdg: string | undefined;
beforeAll(() => {
  previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'forge-issue-comments-xdg-'));
});
afterAll(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
});

const fixture = [
  {
    created_at: '2026-06-10T12:00:00Z',
    user: { login: 'alice' },
    body: 'first comment\nsecond line',
  },
  {
    created_at: '2026-06-11T12:00:00Z',
    user: { login: 'bob' },
    body: 'newest comment',
  },
];

describe('formatGhIssueComments', () => {
  it('reports no comments for an empty array', () => {
    expect(formatGhIssueComments([], 1, 10)).toBe('GH COMMENTS — #1 — none');
  });

  it('formats one line per comment with header and author', () => {
    const out = formatGhIssueComments(fixture, 1, 10);
    expect(out).toContain('GH COMMENTS — #1 — 2');
    expect(out).toContain('alice:');
    expect(out).toContain('bob:');
  });

  it('slices to the newest `limit` comments', () => {
    const out = formatGhIssueComments(fixture, 1, 1);
    expect(out).toContain('last 1 of 2');
    expect(out).toContain('bob:');
    expect(out).not.toContain('alice:');
  });
});

describe('forge_issue_comment_list', () => {
  it('reports GitLab issue comments as not supported yet', async () => {
    const output = await forgeIssueCommentListTool.execute(
      { issue: 1, backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('not supported');
  });
});

describe('forge_issue_comment_create', () => {
  it('reports GitLab issue comments as not supported yet', async () => {
    const output = await forgeIssueCommentCreateTool.execute(
      { issue: 1, body: 'x', backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('not supported');
  });

  it('rejects an empty body', async () => {
    const output = await forgeIssueCommentCreateTool.execute(
      { issue: 1, body: '   ', backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('must not be empty');
  });
});
