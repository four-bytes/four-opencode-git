// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock runGit before importing the module that uses it
const runGitMock = mock();

mock.module('../src/lib/git-utils', () => ({
  ...require('../src/lib/git-utils'),
  runGit: runGitMock,
  parseGitBlame: async (filePath: string, cwd?: string) => {
    const output = await runGitMock(
      ['blame', '--line-porcelain', '--', filePath],
      cwd ?? process.cwd()
    );
    const { parseBlameOutput } = require('../src/lib/git-utils');
    return parseBlameOutput(output);
  },
  parseGitBlameForDir: async (dirPath: string, cwd?: string) => {
    const workDir = cwd ?? process.cwd();
    const result = new Map<string, any[]>();
    let fileList: string;
    try {
      fileList = await runGitMock(['ls-files', '--', dirPath], workDir);
    } catch {
      return result;
    }
    const files = fileList.split('\n').filter((f: string) => f.trim() !== '');
    const { parseBlameOutput } = require('../src/lib/git-utils');
    for (const file of files) {
      const output = await runGitMock(['blame', '--line-porcelain', '--', file], workDir);
      const blame = parseBlameOutput(output);
      if (blame.length > 0) result.set(file, blame);
    }
    return result;
  },
}));

import { computeOwnership } from '../src/tools/ownership';

describe('computeOwnership', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ownership-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  it('returns ownership data for a file (mocked blame)', async () => {
    // Create a dummy file
    writeFileSync(join(testDir, 'test.ts'), 'line1\nline2\nline3\n');

    const blameOutput = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 3',
      'author alice',
      '\tline1',
      '\tline2',
      '\tline3',
    ].join('\n');

    runGitMock.mockImplementation(async (args: string[]) => {
      return blameOutput;
    });

    const result = await computeOwnership('test.ts', testDir);
    expect(result).toContain('OWNERSHIP — test.ts');
    expect(result).toContain('(3 lines)');
    expect(result).toContain('alice');
    expect(result).toContain('100%)');
    expect(result).toContain('KNOWLEDGE SILO');
  });

  it('shows no knowledge silo when ownership <= 80%', async () => {
    writeFileSync(join(testDir, 'shared.ts'), 'line1\nline2\nline3\n');

    const blameOutput = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 2',
      'author alice',
      '\tline1',
      '\tline2',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 3 3 1',
      'author bob',
      '\tline3',
    ].join('\n');

    runGitMock.mockImplementation(async () => blameOutput);

    const result = await computeOwnership('shared.ts', testDir);
    expect(result).toContain('alice');
    expect(result).toContain('bob');
    expect(result).toContain('no knowledge silo');
  });

  it('returns "Path not found" for non-existent path', async () => {
    const result = await computeOwnership('nonexistent.ts', testDir);
    expect(result).toContain('Path not found');
  });

  it('returns "File has no lines" for empty file', async () => {
    writeFileSync(join(testDir, 'empty.ts'), '');

    runGitMock.mockImplementation(async () => '');

    const result = await computeOwnership('empty.ts', testDir);
    expect(result).toContain('File has no lines');
  });

  it('returns directory ownership summary', async () => {
    mkdirSync(join(testDir, 'src'), { recursive: true });
    writeFileSync(join(testDir, 'src', 'a.ts'), 'line1\n');

    // Mock ls-files to return the file
    const blameOutput = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
      'author dougwilson',
      '\tline1',
    ].join('\n');

    let callCount = 0;
    runGitMock.mockImplementation(async (args: string[]) => {
      callCount++;
      if (args[0] === 'ls-files') {
        return 'src/a.ts';
      }
      return blameOutput;
    });

    const result = await computeOwnership('src', testDir);
    expect(result).toContain('OWNERSHIP — src/');
    expect(result).toContain('dougwilson');
    expect(result).toContain('KNOWLEDGE SILO');
  });

  it('returns "No source files in directory" for empty dir', async () => {
    mkdirSync(join(testDir, 'empty-dir'), { recursive: true });

    runGitMock.mockImplementation(async (args: string[]) => {
      return ''; // no files
    });

    const result = await computeOwnership('empty-dir', testDir);
    // The mock returns empty ls-files which yields empty map → "No source files in directory"
    expect(result).toContain('No source files in directory');
  });

  it('handles multiple authors with correct percentages', async () => {
    writeFileSync(join(testDir, 'multi.ts'), 'line\n');

    const blameOutput = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 4',
      'author dougwilson',
      '\tline1',
      '\tline2',
      '\tline3',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 4 4 2',
      'author alice',
      '\tline4',
      '\tline5',
    ].join('\n');

    runGitMock.mockImplementation(async () => blameOutput);

    const result = await computeOwnership('multi.ts', testDir);
    expect(result).toContain('dougwilson');
    expect(result).toContain('alice');
    // 3/5 = 60%, 2/5 = 40%
    expect(result).toContain('60%)');
    expect(result).toContain('40%)');
  });
});
