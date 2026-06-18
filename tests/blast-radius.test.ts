// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock runGit to return controlled git log and blame output
const runGitMock = mock();

mock.module('../src/lib/git-utils', () => {
  const real = require('../src/lib/git-utils');
  return {
    ...real,
    runGit: runGitMock,
    parseGitLog: async (cwd: string, since?: string) => {
      const args = ['log', '--numstat', '--format=%H|%an|%aI'];
      if (since) args.push(`--since=${since}`);
      const output = await runGitMock(args, cwd);
      return real.parseLogOutput(output);
    },
    parseGitBlame: async (filePath: string, cwd?: string) => {
      const workDir = cwd ?? process.cwd();
      try {
        const output = await runGitMock(['blame', '--line-porcelain', '--', filePath], workDir);
        return real.parseBlameOutput(output);
      } catch (err: any) {
        if (
          err.message.includes('no such path') ||
          err.message.includes('exists on disk, but not in')
        ) {
          return [];
        }
        throw err;
      }
    },
  };
});

import { computeBlastRadius } from '../src/tools/blast-radius';

function buildLogOutput(
  commits: {
    hash: string;
    author: string;
    date: string;
    files: { path: string; added: number; deleted: number }[];
  }[]
): string {
  const lines: string[] = [];
  for (const c of commits) {
    lines.push(`${c.hash}|${c.author}|${c.date}`);
    lines.push('');
    for (const f of c.files) {
      lines.push(`${f.added}\t${f.deleted}\t${f.path}`);
    }
  }
  return lines.join('\n');
}

describe('computeBlastRadius', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `blast-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'target.ts'), '// target file\n');
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  it('finds coupled files for target', async () => {
    const logOutput = buildLogOutput([
      {
        hash: 'a'.repeat(40),
        author: 'alice',
        date: new Date().toISOString(),
        files: [
          { path: 'src/core/handler.ts', added: 10, deleted: 0 },
          { path: 'src/core/middleware.ts', added: 5, deleted: 0 },
        ],
      },
      {
        hash: 'b'.repeat(40),
        author: 'alice',
        date: new Date().toISOString(),
        files: [
          { path: 'src/core/handler.ts', added: 3, deleted: 0 },
          { path: 'src/core/middleware.ts', added: 2, deleted: 0 },
        ],
      },
    ]);

    // Mock blame for dominant author
    const blameOutput = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
      'author alice',
      '\tcode',
    ].join('\n');

    runGitMock.mockImplementation(async (args: string[]) => {
      const cmd = args[0];
      if (cmd === 'blame') return blameOutput;
      if (cmd === 'log') return logOutput;
      return '';
    });

    const result = await computeBlastRadius('src/core/handler.ts', testDir);
    expect(result).toContain('BLAST RADIUS — src/core/handler.ts');
    expect(result).toContain('src/core/middleware.ts');
    expect(result).toContain('coupling');
  });

  it('finds shared-author files', async () => {
    // Two separate commits by the same author touching different files
    const logOutput = buildLogOutput([
      {
        hash: 'a'.repeat(40),
        author: 'dougwilson',
        date: new Date().toISOString(),
        files: [{ path: 'src/core/handler.ts', added: 10, deleted: 0 }],
      },
      {
        hash: 'b'.repeat(40),
        author: 'dougwilson',
        date: new Date().toISOString(),
        files: [{ path: 'lib/response.ts', added: 5, deleted: 0 }],
      },
    ]);

    const blameOutput = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 2',
      'author dougwilson',
      '\tcode',
      '\tmore code',
    ].join('\n');

    runGitMock.mockImplementation(async (args: string[]) => {
      const cmd = args[0];
      if (cmd === 'blame') return blameOutput;
      if (cmd === 'log') return logOutput;
      return '';
    });

    const result = await computeBlastRadius('src/core/handler.ts', testDir);
    expect(result).toContain('BLAST RADIUS — src/core/handler.ts');
    expect(result).toContain('shared author');
    expect(result).toContain('dougwilson');
  });

  it('finds same-directory files', async () => {
    const logOutput = buildLogOutput([
      {
        hash: 'a'.repeat(40),
        author: 'alice',
        date: new Date().toISOString(), // recent
        files: [
          { path: 'src/core/handler.ts', added: 10, deleted: 0 },
          { path: 'src/core/validator.ts', added: 5, deleted: 0 },
        ],
      },
    ]);

    const blameOutput = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
      'author alice',
      '\tcode',
    ].join('\n');

    runGitMock.mockImplementation(async (args: string[]) => {
      const cmd = args[0];
      if (cmd === 'blame') return blameOutput;
      if (cmd === 'log') return logOutput;
      return '';
    });

    const result = await computeBlastRadius('src/core/handler.ts', testDir);
    expect(result).toContain('BLAST RADIUS — src/core/handler.ts');
    expect(result).toContain('src/core/validator.ts');
    expect(result).toContain('same directory');
  });

  it('returns error for file not in git history', async () => {
    const logOutput = buildLogOutput([
      {
        hash: 'a'.repeat(40),
        author: 'alice',
        date: new Date().toISOString(),
        files: [{ path: 'other/file.ts', added: 1, deleted: 0 }],
      },
    ]);

    runGitMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'log') return logOutput;
      return '';
    });

    const result = await computeBlastRadius('nonexistent-file.ts', testDir);
    expect(result).toContain('File not found in git history');
  });

  it('sorts by risk score descending', async () => {
    const logOutput = buildLogOutput([
      // handler + middleware always together (strong coupling)
      {
        hash: 'a'.repeat(40),
        author: 'alice',
        date: new Date().toISOString(),
        files: [
          { path: 'src/core/handler.ts', added: 10, deleted: 0 },
          { path: 'src/core/middleware.ts', added: 5, deleted: 0 },
        ],
      },
      {
        hash: 'b'.repeat(40),
        author: 'alice',
        date: new Date().toISOString(),
        files: [
          { path: 'src/core/handler.ts', added: 3, deleted: 0 },
          { path: 'src/core/middleware.ts', added: 2, deleted: 0 },
        ],
      },
      // handler + router sometimes together (weaker coupling)
      {
        hash: 'c'.repeat(40),
        author: 'alice',
        date: new Date().toISOString(),
        files: [
          { path: 'src/core/handler.ts', added: 1, deleted: 0 },
          { path: 'src/core/router.ts', added: 1, deleted: 0 },
        ],
      },
      {
        hash: 'd'.repeat(40),
        author: 'alice',
        date: new Date().toISOString(),
        files: [{ path: 'src/core/handler.ts', added: 2, deleted: 0 }],
      },
      {
        hash: 'e'.repeat(40),
        author: 'alice',
        date: new Date().toISOString(),
        files: [{ path: 'src/core/router.ts', added: 1, deleted: 0 }],
      },
    ]);

    const blameOutput = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
      'author alice',
      '\tcode',
    ].join('\n');

    runGitMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'blame') return blameOutput;
      if (args[0] === 'log') return logOutput;
      return '';
    });

    const result = await computeBlastRadius('src/core/handler.ts', testDir);
    // middleware.ts should appear before router.ts
    const middlewareIdx = result.indexOf('middleware.ts');
    const routerIdx = result.indexOf('router.ts');
    expect(middlewareIdx).toBeGreaterThan(0);
    expect(routerIdx).toBeGreaterThan(0);
    expect(middlewareIdx).toBeLessThan(routerIdx);
  });
});
