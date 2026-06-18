// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { formatIssueList } from '../src/tools/gh-issue-list';
import { formatPrStatus } from '../src/tools/gh-pr-status';
import { formatBranchCleanup } from '../src/tools/gh-branch-cleanup';
import { formatReleaseInfo } from '../src/tools/gh-release-info';

// ────────────────────────────────────────────────────────────────
// Unit tests — formatIssueList
// ────────────────────────────────────────────────────────────────

describe('formatIssueList', () => {
  it('formats a list of open issues', () => {
    const issues = [
      {
        number: 42,
        title: 'Add login endpoint',
        state: 'open',
        labels: ['feature', 'backend'],
        assignees: ['alice'],
        url: 'https://github.com/org/repo/issues/42',
        updatedAt: '2026-06-10T12:00:00Z',
      },
      {
        number: 41,
        title: 'Fix null pointer in router',
        state: 'open',
        labels: ['bug'],
        assignees: ['bob'],
        url: 'https://github.com/org/repo/issues/41',
        updatedAt: '2026-06-09T08:00:00Z',
      },
    ];

    const output = formatIssueList(issues, 'org/repo', 'open');
    expect(output).toContain('GH ISSUE LIST — org/repo — 2 open issues');
    expect(output).toContain('#42');
    expect(output).toContain('Add login endpoint');
    expect(output).toContain('[feature, backend]');
    expect(output).toContain('@alice');
    expect(output).toContain('#41');
    expect(output).toContain('Fix null pointer in router');
    expect(output).toContain('[bug]');
    expect(output).toContain('@bob');
    expect(output).toContain('2026-06-09');
  });

  it('handles empty issue list', () => {
    const output = formatIssueList([], 'org/repo', 'open');
    expect(output).toContain('GH ISSUE LIST — org/repo');
    expect(output).toContain('no open issues found');
  });

  it('handles single issue (singular "issue")', () => {
    const issues = [
      {
        number: 1,
        title: 'Initial setup',
        state: 'closed',
        labels: [],
        assignees: [],
        url: 'https://github.com/org/repo/issues/1',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    const output = formatIssueList(issues, 'org/repo', 'closed');
    expect(output).toContain('1 closed issue');
    // "1 closed issue" contains "issues" as substring; check singular form instead
    expect(output).toMatch(/1 closed issue\b/);
    expect(output).toContain('#1');
    expect(output).toContain('closed');
  });

  it('shows state from parameter in header', () => {
    const issues = [
      {
        number: 99,
        title: 'All states test',
        state: 'open',
        labels: [],
        assignees: [],
        url: 'https://github.com/org/repo/issues/99',
        updatedAt: '2026-06-01T00:00:00Z',
      },
    ];

    const output = formatIssueList(issues, 'org/repo', 'all');
    expect(output).toContain('1 all issue');
  });

  it('handles issues with no labels and no assignees', () => {
    const issues = [
      {
        number: 7,
        title: 'Unassigned issue',
        state: 'open',
        labels: [],
        assignees: [],
        url: 'https://github.com/org/repo/issues/7',
        updatedAt: '2026-06-10T00:00:00Z',
      },
    ];

    const output = formatIssueList(issues, 'org/repo', 'open');
    expect(output).toContain('#7');
    expect(output).toContain('Unassigned issue');
    // Should not have label brackets or assignee prefix when empty
    expect(output).not.toContain('[]');
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — formatPrStatus
// ────────────────────────────────────────────────────────────────

describe('formatPrStatus', () => {
  const basePr = {
    number: 123,
    title: 'feat: add user auth module',
    state: 'OPEN',
    mergeable: 'MERGEABLE' as const,
    mergeStateStatus: 'CLEAN',
    reviews: [],
    statusCheckRollup: null,
    url: 'https://github.com/org/repo/pull/123',
    baseRefName: 'main',
    headRefName: 'feature/auth',
  };

  it('formats a clean, mergeable PR with no reviews or CI', () => {
    const output = formatPrStatus(basePr, 'org/repo');
    expect(output).toContain('PR STATUS — org/repo #123');
    expect(output).toContain('feat: add user auth module');
    expect(output).toContain('feature/auth → main');
    expect(output).toContain('✅ MERGEABLE');
    expect(output).toContain('ready to merge');
    expect(output).toContain('Reviews:    none yet');
    expect(output).toContain('CI Checks:  none configured');
    expect(output).toContain('Waiting for review approval');
  });

  it('shows approved reviews correctly', () => {
    const pr = {
      ...basePr,
      reviews: [
        { author: 'alice', state: 'APPROVED', submittedAt: '2026-06-10T12:00:00Z' },
        { author: 'bob', state: 'APPROVED', submittedAt: '2026-06-10T13:00:00Z' },
      ],
    };

    const output = formatPrStatus(pr, 'org/repo');
    expect(output).toContain('✅ 2 approvals (alice, bob)');
    expect(output).toContain('✅ Ready to merge!');
  });

  it('shows changes requested review', () => {
    const pr = {
      ...basePr,
      reviews: [
        { author: 'alice', state: 'CHANGES_REQUESTED', submittedAt: '2026-06-10T12:00:00Z' },
      ],
    };

    const output = formatPrStatus(pr, 'org/repo');
    expect(output).toContain('❌ 1 change requested (alice)');
    expect(output).toContain('Changes requested — address review feedback');
  });

  it('shows CI check statuses', () => {
    const pr = {
      ...basePr,
      reviews: [{ author: 'alice', state: 'APPROVED', submittedAt: '2026-06-10T12:00:00Z' }],
      statusCheckRollup: [
        { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
        { name: 'build', status: 'IN_PROGRESS', conclusion: null },
      ],
    };

    const output = formatPrStatus(pr, 'org/repo');
    expect(output).toContain('✅ lint (COMPLETED — SUCCESS)');
    expect(output).toContain('❌ test (COMPLETED — FAILURE)');
    expect(output).toContain('🔄 build (IN_PROGRESS)');
    expect(output).toContain('CI checks failing — fix before merging');
  });

  it('shows merge conflict status', () => {
    const pr = {
      ...basePr,
      mergeable: 'CONFLICTING' as const,
      mergeStateStatus: 'DIRTY',
      reviews: [{ author: 'alice', state: 'APPROVED', submittedAt: '2026-06-10T12:00:00Z' }],
    };

    const output = formatPrStatus(pr, 'org/repo');
    expect(output).toContain('❌ CONFLICTING');
    expect(output).toContain('needs update');
    expect(output).toContain('Has merge conflicts — resolve before merging');
  });

  it('handles unknown mergeable state', () => {
    const pr = {
      ...basePr,
      mergeable: 'UNKNOWN' as const,
      mergeStateStatus: 'UNKNOWN',
    };

    const output = formatPrStatus(pr, 'org/repo');
    expect(output).toContain('❓ UNKNOWN');
    expect(output).toContain('Mergeability unknown');
  });

  it('shows commented reviews without decision', () => {
    const pr = {
      ...basePr,
      reviews: [{ author: 'alice', state: 'COMMENTED', submittedAt: '2026-06-10T12:00:00Z' }],
    };

    const output = formatPrStatus(pr, 'org/repo');
    expect(output).toContain('💬 1 comment without decision (alice)');
  });

  it('shows pending CI checks', () => {
    const pr = {
      ...basePr,
      reviews: [{ author: 'alice', state: 'APPROVED', submittedAt: '2026-06-10T12:00:00Z' }],
      statusCheckRollup: [{ name: 'deploy-preview', status: 'IN_PROGRESS', conclusion: null }],
    };

    const output = formatPrStatus(pr, 'org/repo');
    expect(output).toContain('CI checks still running');
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — formatBranchCleanup
// ────────────────────────────────────────────────────────────────

describe('formatBranchCleanup', () => {
  const branches = [
    {
      number: 42,
      headRefName: 'feature/login',
      baseRefName: 'main',
      mergedAt: '2026-06-10T12:00:00Z',
    },
    {
      number: 41,
      headRefName: 'fix/router-null',
      baseRefName: 'main',
      mergedAt: '2026-06-09T08:00:00Z',
    },
  ];

  it('formats dry run output with branches found', () => {
    const output = formatBranchCleanup(branches, [], [], true, 'org/repo');
    expect(output).toContain('GH BRANCH CLEANUP — org/repo — DRY RUN');
    expect(output).toContain('Found 2 merged branches');
    expect(output).toContain('feature/login (PR #42 → main, merged 2026-06-10)');
    expect(output).toContain('fix/router-null (PR #41 → main, merged 2026-06-09)');
    expect(output).toContain('Run with dry_run=false to delete');
  });

  it('formats dry run with no branches found', () => {
    const output = formatBranchCleanup([], [], [], true, 'org/repo');
    expect(output).toContain('DRY RUN');
    expect(output).toContain('No stale merged branches found');
  });

  it('formats successful deletion output', () => {
    const deleted = ['feature/login', 'fix/router-null'];
    const output = formatBranchCleanup(branches, deleted, [], false, 'org/repo');
    expect(output).toContain('GH BRANCH CLEANUP — org/repo');
    expect(output).not.toContain('DRY RUN');
    expect(output).toContain('Deleted 2 branches');
    expect(output).toContain('✓ feature/login');
    expect(output).toContain('✓ fix/router-null');
  });

  it('formats mixed success/failure output', () => {
    const deleted = ['feature/login'];
    const failed = ['fix/router-null'];
    const output = formatBranchCleanup(branches, deleted, failed, false, 'org/repo');
    expect(output).toContain('Deleted 1 branch');
    expect(output).toContain('✓ feature/login');
    expect(output).toContain('Failed to delete 1 branch');
    expect(output).toContain('✗ fix/router-null');
  });

  it('handles all failures', () => {
    const failed = ['feature/login', 'fix/router-null'];
    const output = formatBranchCleanup(branches, [], failed, false, 'org/repo');
    expect(output).toContain('Failed to delete 2 branches');
    expect(output).toContain('✗ feature/login');
    expect(output).toContain('✗ fix/router-null');
  });

  it('handles singular "branch" for single deletion', () => {
    const deleted = ['feature/login'];
    const output = formatBranchCleanup([branches[0]!], deleted, [], false, 'org/repo');
    expect(output).toContain('Deleted 1 branch');
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — formatReleaseInfo
// ────────────────────────────────────────────────────────────────

describe('formatReleaseInfo', () => {
  const release = {
    tagName: 'v1.2.3',
    name: 'Release v1.2.3 — Performance Improvements',
    body: "## What's new\n\n- Faster startup time\n- Reduced memory usage\n- New CLI flags",
    publishedAt: '2026-06-10T14:00:00Z',
    url: 'https://github.com/org/repo/releases/tag/v1.2.3',
    assets: [
      {
        name: 'app-linux-amd64.tar.gz',
        size: 5242880,
        downloadCount: 1523,
        url: 'https://github.com/org/repo/releases/download/v1.2.3/app-linux-amd64.tar.gz',
      },
      {
        name: 'app-darwin-arm64.tar.gz',
        size: 4890120,
        downloadCount: 891,
        url: 'https://github.com/org/repo/releases/download/v1.2.3/app-darwin-arm64.tar.gz',
      },
    ],
  };

  it('formats full release info', () => {
    const output = formatReleaseInfo(release, 'org/repo');
    expect(output).toContain('GH RELEASE — org/repo');
    expect(output).toContain('Tag:        v1.2.3');
    expect(output).toContain('Title:      Release v1.2.3 — Performance Improvements');
    expect(output).toContain('Published:  2026-06-10');
    expect(output).toContain('URL:        https://github.com/org/repo/releases/tag/v1.2.3');
    expect(output).toContain('Release Notes:');
    expect(output).toContain('Faster startup time');
    expect(output).toContain('Assets (2)');
    expect(output).toContain('app-linux-amd64.tar.gz — 5.0 MB — 1523 downloads');
    expect(output).toContain('app-darwin-arm64.tar.gz — 4.7 MB — 891 downloads');
  });

  it('handles release with no name (uses tagName)', () => {
    const r = { ...release, name: null };
    const output = formatReleaseInfo(r, 'org/repo');
    expect(output).toContain('Title:      v1.2.3');
  });

  it('handles release with no assets', () => {
    const r = { ...release, assets: [] };
    const output = formatReleaseInfo(r, 'org/repo');
    expect(output).toContain('Assets:     none');
  });

  it('handles release with no body', () => {
    const r = { ...release, body: '' };
    const output = formatReleaseInfo(r, 'org/repo');
    expect(output).toContain('GH RELEASE — org/repo');
    // Should still render, just without notes section
    expect(output).not.toContain('Release Notes:');
  });

  it('formats file sizes correctly — KB', () => {
    const r = {
      ...release,
      assets: [{ name: 'small.txt', size: 512, downloadCount: 10, url: 'https://example.com' }],
    };
    const output = formatReleaseInfo(r, 'org/repo');
    expect(output).toContain('512 B');
  });

  it('formats file sizes correctly — B', () => {
    const r = {
      ...release,
      assets: [{ name: 'tiny.txt', size: 64, downloadCount: 1, url: 'https://example.com' }],
    };
    const output = formatReleaseInfo(r, 'org/repo');
    expect(output).toContain('64 B');
  });

  it('formats file sizes correctly — MB', () => {
    const r = {
      ...release,
      assets: [
        {
          name: 'large.zip',
          size: 104857600,
          downloadCount: 42,
          url: 'https://example.com',
        },
      ],
    };
    const output = formatReleaseInfo(r, 'org/repo');
    expect(output).toContain('100.0 MB');
  });
});
