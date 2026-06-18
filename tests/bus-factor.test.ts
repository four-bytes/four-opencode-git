// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { computeBusFactorFromLog } from '../src/tools/bus-factor';
import type { Commit } from '../src/lib/git-utils';

function makeCommit(
  hash: string,
  author: string,
  files: { path: string; added: number; deleted: number }[]
): Commit {
  return { hash, author, date: '2024-01-15T00:00:00Z', files };
}

describe('computeBusFactorFromLog', () => {
  it('returns empty array for no commits', () => {
    const results = computeBusFactorFromLog([]);
    expect(results).toEqual([]);
  });

  it('detects bus factor 1 when one author dominates >70%', () => {
    const commits: Commit[] = [
      makeCommit('a'.repeat(40), 'alice', [{ path: 'src/core/a.ts', added: 10, deleted: 0 }]),
      makeCommit('b'.repeat(40), 'alice', [{ path: 'src/core/b.ts', added: 5, deleted: 0 }]),
      makeCommit('c'.repeat(40), 'alice', [{ path: 'src/core/c.ts', added: 3, deleted: 0 }]),
      makeCommit('d'.repeat(40), 'alice', [{ path: 'src/core/d.ts', added: 8, deleted: 0 }]),
      makeCommit('e'.repeat(40), 'bob', [{ path: 'src/core/e.ts', added: 2, deleted: 0 }]),
      makeCommit('f'.repeat(40), 'alice', [{ path: 'src/core/f.ts', added: 1, deleted: 0 }]),
    ];

    const results = computeBusFactorFromLog(commits);
    const coreDir = results.find((r) => r.dir === 'src');
    expect(coreDir).toBeDefined();
    // Total changes for src/ = 6, alice = 5 => 83.3% > 70% => bus factor 1
    expect(coreDir!.busFactor).toBe(1);
    expect(coreDir!.topAuthor).toBe('alice');
    expect(coreDir!.topAuthorPct).toBeGreaterThan(70);
  });

  it('detects bus factor 2 when top author >50% but ≤70%', () => {
    const commits: Commit[] = [
      makeCommit('a'.repeat(40), 'alice', [{ path: 'tests/a.test.ts', added: 10, deleted: 0 }]),
      makeCommit('b'.repeat(40), 'bob', [{ path: 'tests/b.test.ts', added: 5, deleted: 0 }]),
      makeCommit('c'.repeat(40), 'alice', [{ path: 'tests/c.test.ts', added: 3, deleted: 0 }]),
      makeCommit('d'.repeat(40), 'bob', [{ path: 'tests/d.test.ts', added: 5, deleted: 0 }]),
      makeCommit('e'.repeat(40), 'alice', [{ path: 'tests/e.test.ts', added: 4, deleted: 0 }]),
    ];

    const results = computeBusFactorFromLog(commits);
    const testsDir = results.find((r) => r.dir === 'tests');
    expect(testsDir).toBeDefined();
    // alice: 3 changes, bob: 2 changes, total: 5
    // alice = 60% → between 50% and 70% → bus factor 2
    expect(testsDir!.busFactor).toBe(2);
    expect(testsDir!.topAuthorPct).toBeGreaterThan(50);
    expect(testsDir!.topAuthorPct).toBeLessThanOrEqual(70);
  });

  it('detects bus factor 3+ when ownership is distributed', () => {
    const commits: Commit[] = [
      makeCommit('a'.repeat(40), 'alice', [{ path: 'docs/a.md', added: 10, deleted: 0 }]),
      makeCommit('b'.repeat(40), 'bob', [{ path: 'docs/b.md', added: 5, deleted: 0 }]),
      makeCommit('c'.repeat(40), 'charlie', [{ path: 'docs/c.md', added: 5, deleted: 0 }]),
      makeCommit('d'.repeat(40), 'dave', [{ path: 'docs/d.md', added: 5, deleted: 0 }]),
      makeCommit('e'.repeat(40), 'alice', [{ path: 'docs/e.md', added: 3, deleted: 0 }]),
      makeCommit('f'.repeat(40), 'bob', [{ path: 'docs/f.md', added: 3, deleted: 0 }]),
    ];

    const results = computeBusFactorFromLog(commits);
    const docsDir = results.find((r) => r.dir === 'docs');
    expect(docsDir).toBeDefined();
    // alice: 2, bob: 2, charlie: 1, dave: 1, total: 6
    // top = 33.3% → ≤50% → bus factor 3+
    expect(docsDir!.busFactor).toBeGreaterThanOrEqual(3);
  });

  it('skips directories with fewer than 5 commits', () => {
    const commits: Commit[] = [
      makeCommit('a'.repeat(40), 'alice', [{ path: 'tiny/file.ts', added: 5, deleted: 0 }]),
    ];

    const results = computeBusFactorFromLog(commits);
    // tiny/ has 1 commit → < 5 → should be skipped
    const tinyDir = results.find((r) => r.dir === 'tiny');
    expect(tinyDir).toBeUndefined();
  });

  it('handles multiple directories', () => {
    const commits: Commit[] = [
      makeCommit('a'.repeat(40), 'alice', [{ path: 'src/a.ts', added: 10, deleted: 0 }]),
      makeCommit('b'.repeat(40), 'alice', [{ path: 'src/b.ts', added: 5, deleted: 0 }]),
      makeCommit('c'.repeat(40), 'alice', [{ path: 'src/c.ts', added: 3, deleted: 0 }]),
      makeCommit('d'.repeat(40), 'alice', [{ path: 'src/d.ts', added: 5, deleted: 0 }]),
      makeCommit('e'.repeat(40), 'bob', [{ path: 'src/e.ts', added: 2, deleted: 0 }]),
      makeCommit('f'.repeat(40), 'bob', [{ path: 'lib/x.ts', added: 8, deleted: 0 }]),
      makeCommit('g'.repeat(40), 'bob', [{ path: 'lib/y.ts', added: 5, deleted: 0 }]),
      makeCommit('h'.repeat(40), 'bob', [{ path: 'lib/z.ts', added: 5, deleted: 0 }]),
      makeCommit('i'.repeat(40), 'alice', [{ path: 'lib/w.ts', added: 3, deleted: 0 }]),
      makeCommit('j'.repeat(40), 'bob', [{ path: 'lib/v.ts', added: 2, deleted: 0 }]),
    ];

    const results = computeBusFactorFromLog(commits);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const dirs = results.map((r) => r.dir);
    expect(dirs).toContain('src');
    expect(dirs).toContain('lib');
  });

  it('sorts by bus factor (worst first)', () => {
    const commits: Commit[] = [
      // lib/ dominated by bob (>70%)
      makeCommit('a'.repeat(40), 'bob', [{ path: 'lib/a.ts', added: 10, deleted: 0 }]),
      makeCommit('b'.repeat(40), 'bob', [{ path: 'lib/b.ts', added: 5, deleted: 0 }]),
      makeCommit('c'.repeat(40), 'bob', [{ path: 'lib/c.ts', added: 5, deleted: 0 }]),
      makeCommit('d'.repeat(40), 'alice', [{ path: 'lib/d.ts', added: 1, deleted: 0 }]),
      makeCommit('e'.repeat(40), 'bob', [{ path: 'lib/e.ts', added: 5, deleted: 0 }]),
      // src/ shared more evenly
      makeCommit('f'.repeat(40), 'alice', [{ path: 'src/x.ts', added: 5, deleted: 0 }]),
      makeCommit('g'.repeat(40), 'bob', [{ path: 'src/y.ts', added: 4, deleted: 0 }]),
      makeCommit('h'.repeat(40), 'alice', [{ path: 'src/z.ts', added: 5, deleted: 0 }]),
      makeCommit('i'.repeat(40), 'bob', [{ path: 'src/w.ts', added: 4, deleted: 0 }]),
      makeCommit('j'.repeat(40), 'alice', [{ path: 'src/v.ts', added: 5, deleted: 0 }]),
    ];

    const results = computeBusFactorFromLog(commits);
    expect(results.length).toBe(2);
    // lib/ should come first (bus factor 1) before src/ (bus factor 2 or 3+)
    expect(results[0].dir).toBe('lib');
    expect(results[0].busFactor).toBe(1);
  });
});
