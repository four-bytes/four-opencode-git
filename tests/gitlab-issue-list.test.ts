// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import {
  formatGitLabIssueList,
  normalizeGitLabIssues,
} from '../src/tools/gitlab-issue-list';

// Fixture: GET /projects/:id/issues response (trimmed to the fields we read).
const GITLAB_RAW = [
  {
    iid: 42,
    title: 'Fix login redirect',
    state: 'opened',
    labels: ['bug', 'backend'],
    web_url: 'https://gitlab.com/grp/proj/-/issues/42',
    updated_at: '2026-06-10T12:00:00Z',
    assignees: [{ username: 'robby' }, { username: 'anna' }],
  },
  {
    iid: 41,
    title: 'No labels issue',
    state: 'opened',
    labels: [],
    web_url: 'https://gitlab.com/grp/proj/-/issues/41',
    updated_at: '2026-06-09T08:00:00Z',
    assignees: [],
  },
];

describe('normalizeGitLabIssues', () => {
  it('maps iid → number, web_url → url, labels and assignee usernames', () => {
    const issues = normalizeGitLabIssues(GITLAB_RAW);

    expect(issues).toHaveLength(2);
    expect(issues[0]).toEqual({
      number: 42,
      title: 'Fix login redirect',
      state: 'opened',
      labels: ['bug', 'backend'],
      assignees: ['robby', 'anna'],
      url: 'https://gitlab.com/grp/proj/-/issues/42',
      updatedAt: '2026-06-10T12:00:00Z',
    });
    expect(issues[1]!.assignees).toEqual([]);
  });

  it('returns an empty array for a non-array payload', () => {
    expect(normalizeGitLabIssues(null)).toEqual([]);
    expect(normalizeGitLabIssues({ message: '404 Project Not Found' })).toEqual([]);
  });

  it('tolerates string labels and string assignees', () => {
    const issues = normalizeGitLabIssues([
      { iid: 1, title: 'x', state: 'opened', labels: ['plain'], assignees: ['bob'] },
    ]);
    expect(issues[0]!.labels).toEqual(['plain']);
    expect(issues[0]!.assignees).toEqual(['bob']);
  });
});

describe('formatGitLabIssueList', () => {
  it('formats one line per issue with labels', () => {
    const issues = normalizeGitLabIssues(GITLAB_RAW);
    const output = formatGitLabIssueList(issues, 'grp/proj', 'open');

    expect(output).toContain('GITLAB ISSUE LIST — grp/proj — 2 open issues');
    expect(output).toContain('  #42 [bug, backend] Fix login redirect');
    expect(output).toContain('  #41 No labels issue');
    // header + blank + 2 issue lines
    expect(output.split('\n')).toHaveLength(4);
  });

  it('handles an empty issue list', () => {
    const output = formatGitLabIssueList([], 'grp/proj', 'open');
    expect(output).toBe('GITLAB ISSUE LIST — grp/proj — no open issues found.');
  });

  it('uses singular "issue" for a single result', () => {
    const issues = normalizeGitLabIssues(GITLAB_RAW.slice(0, 1));
    const output = formatGitLabIssueList(issues, 'grp/proj', 'closed');
    expect(output).toMatch(/1 closed issue\b/);
  });
});
