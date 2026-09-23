// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import {
  detectBackend,
  formatIssueList,
  noBackendMessage,
  normalizeGitHubIssues,
  normalizeIssues,
  resolveBackend,
  type CommonIssue,
} from '../src/tools/issue-list';

// Fixtures — one raw issue shape per backend, trimmed to the fields we read.

const GITHUB_RAW = [
  {
    number: 1303,
    title: 'Add "updated today/yesterday" filters to invoice list',
    state: 'OPEN',
    labels: [{ name: 'spec-change' }, { name: 'backend' }],
    assignees: [{ login: 'robby' }],
    url: 'https://github.com/four-bytes/session-sw6/issues/1303',
    updatedAt: '2026-06-10T12:00:00Z',
  },
];

const GITLAB_RAW = [
  {
    iid: 1298,
    title: 'Vendor stock import: headers already sent',
    state: 'opened',
    labels: ['bug'],
    web_url: 'https://gitlab.com/grp/proj/-/issues/1298',
    updated_at: '2026-06-10T12:00:00Z',
    assignees: [{ username: 'robby' }],
  },
];

const FORGEJO_RAW = [
  {
    number: 77,
    title: 'Adopt contract and trust CMS element styling',
    state: 'open',
    labels: [{ name: 'spec-change' }],
    html_url: 'https://git.4serv.de/scr/dev-playground/issues/77',
    updated_at: '2026-06-10T12:00:00Z',
    assignees: [{ login: 'robby' }],
  },
];

// ────────────────────────────────────────────────────────────────
// detectBackend — forge detection from the origin remote
// ────────────────────────────────────────────────────────────────

describe('detectBackend', () => {
  it('detects GitHub from https and ssh remotes', () => {
    expect(detectBackend('https://github.com/four-bytes/repo.git', {})).toBe('github');
    expect(detectBackend('git@github.com:four-bytes/repo.git', {})).toBe('github');
  });

  it('detects GitLab from gitlab.com, GITLAB_HOST, or GITLAB_TOKEN', () => {
    expect(detectBackend('https://gitlab.com/grp/proj.git', {})).toBe('gitlab');
    expect(
      detectBackend('https://gitlab.example.com/grp/proj.git', {
        GITLAB_HOST: 'https://gitlab.example.com',
      })
    ).toBe('gitlab');
    expect(detectBackend('https://code.example.org/grp/proj.git', { GITLAB_TOKEN: 'x' })).toBe(
      'gitlab'
    );
  });

  it('detects Forgejo from FORGEJO_HOST or FORGEJO_TOKEN', () => {
    expect(
      detectBackend('https://git.4serv.de/scr/dev-playground.git', {
        FORGEJO_HOST: 'https://git.4serv.de',
      })
    ).toBe('forgejo');
    expect(
      detectBackend('git@git.4serv.de:scr/dev-playground.git', { FORGEJO_TOKEN: 'x' })
    ).toBe('forgejo');
  });

  it('matches hosts without a scheme in env', () => {
    expect(
      detectBackend('https://git.4serv.de/scr/dev-playground.git', {
        FORGEJO_HOST: 'git.4serv.de',
      })
    ).toBe('forgejo');
  });

  it('returns null for an unknown host with no config', () => {
    expect(detectBackend('https://bitbucket.org/o/r.git', {})).toBeNull();
    expect(detectBackend(null, {})).toBeNull();
  });

  it('prefers GitHub over both tokens', () => {
    expect(
      detectBackend('https://github.com/o/r.git', {
        FORGEJO_TOKEN: 'x',
        GITLAB_TOKEN: 'y',
      })
    ).toBe('github');
  });

  it('prefers Forgejo over GitLab when both tokens are present', () => {
    expect(
      detectBackend('https://code.example.org/o/r.git', {
        FORGEJO_TOKEN: 'x',
        GITLAB_TOKEN: 'y',
      })
    ).toBe('forgejo');
  });
});

// ────────────────────────────────────────────────────────────────
// resolveBackend — explicit override
// ────────────────────────────────────────────────────────────────

describe('resolveBackend', () => {
  it('lets the override win over detection', () => {
    expect(resolveBackend('https://bitbucket.org/o/r.git', {}, 'gitlab')).toBe('gitlab');
    expect(resolveBackend('https://gitlab.com/o/r.git', {}, 'github')).toBe('github');
  });

  it('falls back to detection when no override is given', () => {
    expect(resolveBackend('https://github.com/o/r.git', {})).toBe('github');
    expect(resolveBackend('https://bitbucket.org/o/r.git', {})).toBeNull();
  });
});

describe('noBackendMessage', () => {
  it('names the remote host', () => {
    expect(noBackendMessage('https://bitbucket.org/o/r.git')).toBe(
      'No issue backend for bitbucket.org.'
    );
  });

  it('falls back to a generic label when the remote is missing', () => {
    expect(noBackendMessage(null)).toBe('No issue backend for origin remote.');
  });
});

// ────────────────────────────────────────────────────────────────
// Normalizers → common shape
// ────────────────────────────────────────────────────────────────

describe('normalizeIssues', () => {
  it('normalizes GitHub issues to the common shape', () => {
    expect(normalizeIssues('github', GITHUB_RAW)).toEqual([
      {
        number: 1303,
        title: 'Add "updated today/yesterday" filters to invoice list',
        state: 'OPEN',
        labels: ['spec-change', 'backend'],
        url: 'https://github.com/four-bytes/session-sw6/issues/1303',
      },
    ]);
  });

  it('normalizes GitLab issues to the common shape', () => {
    expect(normalizeIssues('gitlab', GITLAB_RAW)).toEqual([
      {
        number: 1298,
        title: 'Vendor stock import: headers already sent',
        state: 'opened',
        labels: ['bug'],
        url: 'https://gitlab.com/grp/proj/-/issues/1298',
      },
    ]);
  });

  it('normalizes Forgejo issues to the common shape', () => {
    expect(normalizeIssues('forgejo', FORGEJO_RAW)).toEqual([
      {
        number: 77,
        title: 'Adopt contract and trust CMS element styling',
        state: 'open',
        labels: ['spec-change'],
        url: 'https://git.4serv.de/scr/dev-playground/issues/77',
      },
    ]);
  });

  it('returns an empty array for non-array payloads', () => {
    expect(normalizeIssues('github', {})).toEqual([]);
    expect(normalizeIssues('gitlab', 'nope')).toEqual([]);
    expect(normalizeIssues('forgejo', null)).toEqual([]);
  });

  it('normalizeGitHubIssues tolerates plain-string labels', () => {
    const issues = normalizeGitHubIssues([
      { number: 1, title: 'x', state: 'OPEN', labels: ['plain'], url: 'u' },
    ]);
    expect(issues[0]!.labels).toEqual(['plain']);
  });
});

// ────────────────────────────────────────────────────────────────
// formatIssueList — identical one-line output for every backend
// ────────────────────────────────────────────────────────────────

describe('formatIssueList', () => {
  it('renders one line per issue with a single label in brackets', () => {
    const issues: CommonIssue[] = [
      {
        number: 1303,
        title: 'Add "updated today/yesterday" filters to invoice list',
        state: 'open',
        labels: ['spec-change'],
      },
      {
        number: 1298,
        title: 'Vendor stock import: headers already sent',
        state: 'open',
        labels: ['bug'],
      },
    ];

    expect(formatIssueList(issues, 'open')).toBe(
      '#1303 [spec-change] Add "updated today/yesterday" filters to invoice list\n' +
        '#1298 [bug] Vendor stock import: headers already sent'
    );
  });

  it('uses only the first label', () => {
    const issues: CommonIssue[] = [
      { number: 5, title: 'Multi label', state: 'open', labels: ['bug', 'backend'] },
    ];
    expect(formatIssueList(issues)).toBe('#5 [bug] Multi label');
  });

  it('omits brackets when there is no label', () => {
    const issues: CommonIssue[] = [
      { number: 7, title: 'No labels here', state: 'open', labels: [] },
    ];
    expect(formatIssueList(issues)).toBe('#7 No labels here');
  });

  it('reports an empty list without backend-specific wording', () => {
    expect(formatIssueList([], 'closed')).toBe('No closed issues found.');
  });

  it('produces the same string from every backend normalizer', () => {
    const github = formatIssueList(normalizeIssues('github', GITHUB_RAW));
    const gitlab = formatIssueList(normalizeIssues('gitlab', GITLAB_RAW));
    const forgejo = formatIssueList(normalizeIssues('forgejo', FORGEJO_RAW));

    expect(github.startsWith('#1303 [spec-change] ')).toBe(true);
    expect(gitlab).toBe('#1298 [bug] Vendor stock import: headers already sent');
    expect(forgejo).toBe('#77 [spec-change] Adopt contract and trust CMS element styling');
  });
});
