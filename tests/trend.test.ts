// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { computeTrend, formatTrendOutput } from '../src/tools/trend';
import type { Commit } from '../src/lib/git-utils';

// Helper: create a commit with given files
function makeCommit(
  hash: string,
  author: string,
  date: string,
  files: { path: string; added: number; deleted: number }[]
): Commit {
  return { hash, author, date, files };
}

describe('computeTrend', () => {
  it('detects files with increasing curse score (positive trend)', () => {
    const recentCommits: Commit[] = [
      makeCommit('a'.repeat(40), 'Alice', '2026-06-10T00:00:00Z', [
        { path: 'src/hot.ts', added: 50, deleted: 10 },
        { path: 'src/warm.ts', added: 20, deleted: 5 },
      ]),
      makeCommit('b'.repeat(40), 'Bob', '2026-06-09T00:00:00Z', [
        { path: 'src/hot.ts', added: 30, deleted: 5 },
      ]),
      makeCommit('c'.repeat(40), 'Alice', '2026-06-08T00:00:00Z', [
        { path: 'src/hot.ts', added: 10, deleted: 2 },
      ]),
    ];

    const olderCommits: Commit[] = [
      makeCommit('d'.repeat(40), 'Alice', '2026-03-01T00:00:00Z', [
        { path: 'src/hot.ts', added: 5, deleted: 1 },
      ]),
      makeCommit('e'.repeat(40), 'Alice', '2026-02-01T00:00:00Z', [
        { path: 'src/warm.ts', added: 3, deleted: 1 },
      ]),
    ];

    const result = computeTrend(recentCommits, olderCommits, 90, 10);

    expect(result.insufficientHistory).toBe(false);
    expect(result.worsening.length).toBeGreaterThan(0);
    // Files with recent activity should show positive trend
    const hotFile = result.worsening.find((r) => r.file === 'src/hot.ts');
    expect(hotFile).toBeDefined();
    expect(hotFile!.delta).toBeGreaterThan(0);
    expect(hotFile!.recentScore).toBeGreaterThan(hotFile!.olderScore);
  });

  it('detects improving files (negative trend)', () => {
    const recentCommits: Commit[] = [
      makeCommit('a'.repeat(40), 'Alice', '2026-06-01T00:00:00Z', [
        { path: 'src/calming.ts', added: 2, deleted: 1 },
      ]),
    ];

    const olderCommits: Commit[] = [
      makeCommit('b'.repeat(40), 'Bob', '2026-02-01T00:00:00Z', [
        { path: 'src/calming.ts', added: 30, deleted: 15 },
      ]),
      makeCommit('c'.repeat(40), 'Bob', '2026-01-15T00:00:00Z', [
        { path: 'src/calming.ts', added: 20, deleted: 10 },
      ]),
      makeCommit('d'.repeat(40), 'Alice', '2026-01-01T00:00:00Z', [
        { path: 'src/calming.ts', added: 15, deleted: 5 },
      ]),
    ];

    const result = computeTrend(recentCommits, olderCommits, 90, 10);

    expect(result.improving.length).toBeGreaterThan(0);
    const calmFile = result.improving.find((r) => r.file === 'src/calming.ts');
    expect(calmFile).toBeDefined();
    expect(calmFile!.delta).toBeLessThan(0);
  });

  it('respects top parameter', () => {
    const recentCommits: Commit[] = [];
    const olderCommits: Commit[] = [];

    // Create commits with many distinct files
    for (let i = 0; i < 20; i++) {
      recentCommits.push(
        makeCommit(
          `${String(i).repeat(40 - String(i).length)}${'a'.repeat(Math.max(0, 40 - String(i).length))}`,
          'Alice',
          '2026-06-01T00:00:00Z',
          [{ path: `src/file${i}.ts`, added: i + 10, deleted: i }]
        )
      );
      olderCommits.push(
        makeCommit(
          `${String(i + 100).repeat(40 - String(i + 100).length)}${'b'.repeat(Math.max(0, 40 - String(i + 100).length))}`,
          'Alice',
          '2026-02-01T00:00:00Z',
          [{ path: `src/file${i}.ts`, added: i, deleted: 0 }]
        )
      );
    }

    const result = computeTrend(recentCommits, olderCommits, 90, 5);
    expect(result.worsening.length).toBeLessThanOrEqual(5);
  });

  it('handles insufficient history (no older commits)', () => {
    const recentCommits: Commit[] = [
      makeCommit('a'.repeat(40), 'Alice', '2026-06-01T00:00:00Z', [
        { path: 'src/new.ts', added: 10, deleted: 0 },
      ]),
    ];

    const result = computeTrend(recentCommits, [], 90, 10);
    expect(result.insufficientHistory).toBe(true);
    expect(result.worsening).toHaveLength(0);
  });

  it('marks new files (no older score)', () => {
    const recentCommits: Commit[] = [
      makeCommit('a'.repeat(40), 'Alice', '2026-06-10T00:00:00Z', [
        { path: 'src/new.ts', added: 30, deleted: 5 },
      ]),
    ];

    const olderCommits: Commit[] = [
      makeCommit('b'.repeat(40), 'Alice', '2026-03-01T00:00:00Z', [
        { path: 'src/old.ts', added: 10, deleted: 0 },
      ]),
    ];

    const result = computeTrend(recentCommits, olderCommits, 90, 10);
    const newFile = result.worsening.find((r) => r.file === 'src/new.ts');
    expect(newFile).toBeDefined();
    expect(newFile!.note).toBe('new file, no older score');
    expect(newFile!.olderScore).toBe(0);
  });

  it('marks deleted files', () => {
    const recentCommits: Commit[] = [
      makeCommit('a'.repeat(40), 'Alice', '2026-06-01T00:00:00Z', [
        { path: 'src/current.ts', added: 5, deleted: 0 },
      ]),
    ];

    const olderCommits: Commit[] = [
      makeCommit('b'.repeat(40), 'Alice', '2026-03-01T00:00:00Z', [
        { path: 'src/deleted.ts', added: 20, deleted: 5 },
      ]),
    ];

    const result = computeTrend(recentCommits, olderCommits, 90, 10);
    const deletedFile = result.improving.find((r) => r.file === 'src/deleted.ts');
    expect(deletedFile).toBeDefined();
    expect(deletedFile!.note).toBe('deleted');
    expect(deletedFile!.recentScore).toBe(0);
    expect(deletedFile!.delta).toBeLessThan(0);
  });

  it('returns empty when no commits at all', () => {
    const result = computeTrend([], [], 90, 10);
    expect(result.worsening).toHaveLength(0);
    expect(result.improving).toHaveLength(0);
    expect(result.insufficientHistory).toBe(false);
  });
});

describe('formatTrendOutput', () => {
  it('formats worsening and improving files', () => {
    const result = {
      insufficientHistory: false,
      worsening: [
        { file: 'src/hot.ts', recentScore: 100, olderScore: 50, delta: 50 },
        { file: 'src/warm.ts', recentScore: 80, olderScore: 60, delta: 20 },
      ],
      improving: [{ file: 'src/cool.ts', recentScore: 20, olderScore: 80, delta: -60 }],
    };

    const output = formatTrendOutput(result, 90, 10);
    expect(output).toContain('TREND');
    expect(output).toContain('src/hot.ts');
    expect(output).toContain('Δ +50');
    expect(output).toContain('src/cool.ts');
    expect(output).toContain('Δ -60');
    expect(output).toContain('Improving:');
  });

  it('shows insufficient history message', () => {
    const output = formatTrendOutput(
      { insufficientHistory: true, worsening: [], improving: [] },
      90,
      10
    );
    expect(output).toContain('insufficient history');
  });

  it('shows no changes message for empty results', () => {
    const output = formatTrendOutput(
      { insufficientHistory: false, worsening: [], improving: [] },
      90,
      10
    );
    expect(output).toContain('no significant changes');
  });

  it('includes note for new files', () => {
    const result = {
      insufficientHistory: false,
      worsening: [
        {
          file: 'src/new.ts',
          recentScore: 50,
          olderScore: 0,
          delta: 50,
          note: 'new file, no older score',
        },
      ],
      improving: [],
    };

    const output = formatTrendOutput(result, 90, 10);
    expect(output).toContain('[new file, no older score]');
  });
});
