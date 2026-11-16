// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import {
  formatForgejoRepoList,
  normalizeForgejoRepoList,
  type ForgejoRepoListItem,
} from '../src/tools/forgejo-repo-list';
import { buildCreateRepoBody } from '../src/tools/forgejo-repo-create';
import { resolveRepoArg } from '../src/tools/forgejo-repo-archive';

// ────────────────────────────────────────────────────────────────
// Fixtures — GET /user/repos
// ────────────────────────────────────────────────────────────────

const repoFixture = [
  {
    id: 3,
    full_name: 'acme/widgets',
    description: 'Widget store',
    private: true,
    archived: false,
    updated_at: '2026-06-10T12:00:00Z',
    owner: { login: 'acme' },
  },
  {
    id: 4,
    full_name: 'acme/gadgets',
    description: null,
    private: false,
    archived: true,
    updated_at: '2026-05-01T08:00:00Z',
    owner: { login: 'acme' },
  },
];

// ────────────────────────────────────────────────────────────────
// normalizeForgejoRepoList
// ────────────────────────────────────────────────────────────────

describe('normalizeForgejoRepoList', () => {
  it('maps raw repo objects to the normalized shape', () => {
    const repos = normalizeForgejoRepoList(repoFixture);

    expect(repos).toHaveLength(2);
    expect(repos[0]).toEqual({
      full_name: 'acme/widgets',
      description: 'Widget store',
      private: true,
      archived: false,
      updated_at: '2026-06-10T12:00:00Z',
    });
    expect(repos[1]!.description).toBe('');
    expect(repos[1]!.private).toBe(false);
    expect(repos[1]!.archived).toBe(true);
  });

  it('returns an empty list for non-array input', () => {
    expect(normalizeForgejoRepoList(null)).toEqual([]);
    expect(normalizeForgejoRepoList({ message: 'nope' })).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────
// formatForgejoRepoList
// ────────────────────────────────────────────────────────────────

describe('formatForgejoRepoList', () => {
  it('formats one line per repo with visibility and archived markers', () => {
    const repos = normalizeForgejoRepoList(repoFixture);
    const output = formatForgejoRepoList(repos, 'org acme');

    expect(output).toContain('FORGEJO REPO LIST — org acme — 2 repositories');
    expect(output).toContain('  acme/widgets [private] — Widget store');
    expect(output).toContain('  acme/gadgets [public] [archived]');
    // Header + blank + 2 repo lines.
    expect(output.split('\n')).toHaveLength(4);
  });

  it('collapses a multi-line description onto the repo line', () => {
    const repos: ForgejoRepoListItem[] = [
      {
        full_name: 'acme/widgets',
        description: 'first line\nsecond line',
        private: false,
        archived: false,
      },
    ];
    const output = formatForgejoRepoList(repos, 'user');
    expect(output).toContain('  acme/widgets [public] — first line second line');
    expect(output.split('\n')).toHaveLength(3);
  });

  it('handles an empty repo list', () => {
    const output = formatForgejoRepoList([], 'user');
    expect(output).toBe('FORGEJO REPO LIST — user — no repositories found.');
  });

  it('uses singular "repository" for a single result', () => {
    const repos = normalizeForgejoRepoList(repoFixture).slice(0, 1);
    const output = formatForgejoRepoList(repos, 'user');
    expect(output).toMatch(/1 repository\b/);
  });
});

// ────────────────────────────────────────────────────────────────
// buildCreateRepoBody
// ────────────────────────────────────────────────────────────────

describe('buildCreateRepoBody', () => {
  it('defaults private to true and auto_init to false, omitting undefined fields', () => {
    expect(buildCreateRepoBody({ name: 'widgets' })).toEqual({
      name: 'widgets',
      private: true,
      auto_init: false,
    });
  });

  it('includes every provided field', () => {
    expect(
      buildCreateRepoBody({
        name: 'widgets',
        description: 'Widget store',
        private: false,
        auto_init: true,
        default_branch: 'develop',
      })
    ).toEqual({
      name: 'widgets',
      description: 'Widget store',
      private: false,
      auto_init: true,
      default_branch: 'develop',
    });
  });

  it('keeps an explicitly empty description', () => {
    const body = buildCreateRepoBody({ name: 'widgets', description: '' });
    expect(body).toHaveProperty('description', '');
  });
});

// ────────────────────────────────────────────────────────────────
// resolveRepoArg
// ────────────────────────────────────────────────────────────────

describe('resolveRepoArg', () => {
  it('prefers an explicit owner/repo and trims it', () => {
    expect(resolveRepoArg('  other/thing  ', 'acme/widgets')).toBe('other/thing');
  });

  it('falls back to the current repo from origin', () => {
    expect(resolveRepoArg(undefined, 'acme/widgets')).toBe('acme/widgets');
    expect(resolveRepoArg('', 'acme/widgets')).toBe('acme/widgets');
  });

  it('rejects an explicit value without exactly one slash', () => {
    expect(resolveRepoArg('widgets', 'acme/widgets')).toMatch(/^Error: invalid repo/);
    expect(resolveRepoArg('acme/', 'acme/widgets')).toMatch(/^Error: invalid repo/);
    expect(resolveRepoArg('a/b/c', 'acme/widgets')).toMatch(/^Error: invalid repo/);
  });

  it('errors when neither an argument nor the origin resolves', () => {
    expect(resolveRepoArg(undefined, null)).toMatch(/^Error: could not determine repository/);
    expect(resolveRepoArg(undefined, '')).toMatch(/^Error: could not determine repository/);
    expect(resolveRepoArg(undefined, 'widgets')).toMatch(/^Error: could not determine repository/);
  });
});
