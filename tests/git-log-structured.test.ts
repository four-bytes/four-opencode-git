// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { parseStatOutput, formatLogOutput } from '../src/tools/git-log-structured';

describe('parseStatOutput', () => {
  it('parses standard git show --stat output', () => {
    const raw = [
      ' src/file1.ts | 10 ++++++----',
      ' src/file2.ts | 5 +++--',
      ' 2 files changed, 10 insertions(+), 6 deletions(-)',
    ].join('\n');

    const files = parseStatOutput(raw);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('src/file1.ts');
    expect(files[0].added).toBe(6);
    expect(files[0].deleted).toBe(4);
    expect(files[1].path).toBe('src/file2.ts');
    expect(files[1].added).toBe(3);
    expect(files[1].deleted).toBe(2);
  });

  it('handles new file with only additions', () => {
    const raw = [' src/new.ts | 20 ++++++++++++++++++++', ' 1 file changed, 20 insertions(+)'].join(
      '\n'
    );

    const files = parseStatOutput(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/new.ts');
    expect(files[0].added).toBe(20);
    expect(files[0].deleted).toBe(0);
  });

  it('handles deleted file with only deletions', () => {
    const raw = [' src/old.ts | 15 ---------------', ' 1 file changed, 15 deletions(-)'].join('\n');

    const files = parseStatOutput(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/old.ts');
    expect(files[0].added).toBe(0);
    expect(files[0].deleted).toBe(15);
  });

  it('skips binary files', () => {
    const raw = [
      ' assets/logo.png | Bin 1234 -> 5678 bytes',
      ' src/code.ts | 3 ++-',
      ' 2 files changed, 2 insertions(+), 1 deletion(-)',
    ].join('\n');

    const files = parseStatOutput(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/code.ts');
  });

  it('handles empty output', () => {
    const files = parseStatOutput('');
    expect(files).toHaveLength(0);
  });

  it('handles files with only a number (no +/- signs)', () => {
    const raw = [' src/simple.ts | 8', ' 1 file changed, 8 insertions(+)'].join('\n');

    const files = parseStatOutput(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/simple.ts');
    expect(files[0].added).toBe(8);
    expect(files[0].deleted).toBe(0);
  });
});

describe('formatLogOutput', () => {
  it('formats summary output', () => {
    const entries = [
      {
        hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        author: 'alice',
        date: '2026-06-10T12:00:00+00:00',
        subject: 'feat: add handler #42',
      },
      {
        hash: 'e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8t9u0v1w2',
        author: 'bob',
        date: '2026-06-09T10:00:00+00:00',
        subject: 'fix: null check in router #41',
      },
    ];

    const output = formatLogOutput(entries, 'summary');
    expect(output).toContain('GIT LOG — last 2 commits');
    expect(output).toContain('a1b2c3d');
    expect(output).toContain('alice');
    expect(output).toContain('2026-06-10');
    expect(output).toContain('feat: add handler #42');
    expect(output).toContain('e4f5g6h');
    expect(output).toContain('bob');
  });

  it('formats detailed output with file stats', () => {
    const entries = [
      {
        hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        author: 'alice',
        date: '2026-06-10T12:00:00+00:00',
        subject: 'feat: add handler #42',
        files: [
          { path: 'src/core/handler.ts', added: 45, deleted: 3 },
          { path: 'tests/handler.test.ts', added: 32, deleted: 0 },
        ],
      },
    ];

    const output = formatLogOutput(entries, 'detailed');
    expect(output).toContain('GIT LOG — detailed');
    expect(output).toContain('feat: add handler #42');
    expect(output).toContain('src/core/handler.ts (+45, -3)');
    expect(output).toContain('tests/handler.test.ts (+32, -0)');
  });

  it('handles empty entries', () => {
    const output = formatLogOutput([], 'summary');
    expect(output).toContain('last 0 commits');
  });

  it('detailed without files still renders', () => {
    const entries = [
      {
        hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        author: 'alice',
        date: '2026-06-10T12:00:00+00:00',
        subject: 'chore: update dependencies',
      },
    ];

    const output = formatLogOutput(entries, 'detailed');
    expect(output).toContain('alice');
    expect(output).toContain('chore: update dependencies');
    expect(output).not.toContain('Files:');
  });

  it('uses singular "commit" for single entry', () => {
    const entries = [
      {
        hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        author: 'alice',
        date: '2026-06-10T12:00:00+00:00',
        subject: 'feat: add handler #42',
      },
    ];

    const output = formatLogOutput(entries, 'summary');
    expect(output).toContain('last 1 commit');
  });
});
