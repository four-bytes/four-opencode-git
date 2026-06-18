// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { computeCoupling } from '../src/tools/implicit-coupling';
import type { Commit } from '../src/lib/git-utils';

function makeCommit(
  hash: string,
  author: string,
  files: { path: string; added: number; deleted: number }[]
): Commit {
  return { hash, author, date: '2024-01-15T00:00:00Z', files };
}

describe('computeCoupling', () => {
  it('returns empty for no multi-file commits', () => {
    const commits: Commit[] = [
      makeCommit('a'.repeat(40), 'Alice', [{ path: 'src/a.ts', added: 1, deleted: 0 }]),
    ];

    const results = computeCoupling(commits, 0.5);
    expect(results).toHaveLength(0);
  });

  it('finds perfectly coupled file pairs (1.0)', () => {
    const commits: Commit[] = [
      makeCommit('a'.repeat(40), 'Alice', [
        { path: 'src/a.ts', added: 1, deleted: 0 },
        { path: 'src/b.ts', added: 1, deleted: 0 },
      ]),
      makeCommit('b'.repeat(40), 'Alice', [
        { path: 'src/a.ts', added: 1, deleted: 0 },
        { path: 'src/b.ts', added: 1, deleted: 0 },
      ]),
    ];

    const results = computeCoupling(commits, 0.5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const pair = results.find((r) => r.files.includes('src/a.ts') && r.files.includes('src/b.ts'));
    expect(pair).toBeDefined();
    expect(pair!.coCommits).toBe(2);
    expect(pair!.couplingStrength).toBe(1.0);
  });

  it('computes partial coupling strength correctly', () => {
    const commits: Commit[] = [
      makeCommit('a'.repeat(40), 'Alice', [
        { path: 'src/a.ts', added: 1, deleted: 0 },
        { path: 'src/b.ts', added: 1, deleted: 0 },
      ]),
      makeCommit('b'.repeat(40), 'Alice', [
        { path: 'src/a.ts', added: 1, deleted: 0 },
        { path: 'src/c.ts', added: 1, deleted: 0 },
      ]),
    ];

    // a-b: co-commit once out of max(a=2, b=1) = 2 → 0.5
    // a-c: co-commit once out of max(a=2, c=1) = 2 → 0.5
    // b-c: co-commit 0 out of max(b=1, c=1) = 1 → 0.0

    // With threshold 0.4, a-b and a-c should appear
    const results = computeCoupling(commits, 0.4);
    expect(results.length).toBe(2);

    // Verify a-b pair
    const abPair = results.find(
      (r) => r.files.includes('src/a.ts') && r.files.includes('src/b.ts')
    );
    expect(abPair).toBeDefined();
    expect(abPair!.couplingStrength).toBe(0.5);
  });

  it('respects threshold parameter', () => {
    const commits: Commit[] = [
      makeCommit('a'.repeat(40), 'Alice', [
        { path: 'src/a.ts', added: 1, deleted: 0 },
        { path: 'src/b.ts', added: 1, deleted: 0 },
      ]),
      makeCommit('b'.repeat(40), 'Alice', [
        { path: 'src/a.ts', added: 1, deleted: 0 },
        { path: 'src/c.ts', added: 1, deleted: 0 },
      ]),
    ];

    // Threshold 0.9 — nothing passes (a-b = 0.5, a-c = 0.5)
    const highThreshold = computeCoupling(commits, 0.9);
    expect(highThreshold).toHaveLength(0);

    // Threshold 0.4 — a-b passes
    const lowThreshold = computeCoupling(commits, 0.4);
    expect(lowThreshold.length).toBeGreaterThan(0);
  });

  it('handles multiple pairs in one commit', () => {
    const commits: Commit[] = [
      makeCommit('a'.repeat(40), 'Alice', [
        { path: 'src/a.ts', added: 1, deleted: 0 },
        { path: 'src/b.ts', added: 1, deleted: 0 },
        { path: 'src/c.ts', added: 1, deleted: 0 },
      ]),
    ];

    const results = computeCoupling(commits, 0.5);
    // 3 files = 3 pairs: ab, ac, bc — all with strength 1.0
    expect(results).toHaveLength(3);
    expect(results[0].couplingStrength).toBe(1.0);
  });

  it('sorts by coupling strength descending', () => {
    const commits: Commit[] = [
      // a-b always together (perfect coupling)
      makeCommit('a'.repeat(40), 'Alice', [
        { path: 'src/a.ts', added: 1, deleted: 0 },
        { path: 'src/b.ts', added: 1, deleted: 0 },
      ]),
      makeCommit('b'.repeat(40), 'Alice', [
        { path: 'src/a.ts', added: 1, deleted: 0 },
        { path: 'src/b.ts', added: 1, deleted: 0 },
        { path: 'src/c.ts', added: 1, deleted: 0 },
      ]),
    ];

    const results = computeCoupling(commits, 0.3);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // First result should have highest strength
    expect(results[0].couplingStrength).toBeGreaterThanOrEqual(
      results[results.length - 1].couplingStrength
    );
  });

  it('returns empty for empty commits', () => {
    const results = computeCoupling([], 0.5);
    expect(results).toHaveLength(0);
  });

  it('handles threshold of 0 (returns all pairs)', () => {
    const commits: Commit[] = [
      makeCommit('a'.repeat(40), 'Alice', [
        { path: 'src/a.ts', added: 1, deleted: 0 },
        { path: 'src/b.ts', added: 1, deleted: 0 },
      ]),
    ];

    const results = computeCoupling(commits, 0);
    expect(results).toHaveLength(1);
  });
});
