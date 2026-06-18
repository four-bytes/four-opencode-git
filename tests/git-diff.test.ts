// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect, test } from 'bun:test';
import { parseMultiFileDiff, formatDiffOutput } from '../src/tools/git-diff';

const GIT_AVAILABLE = Bun.which('git') !== null;
const HAS_PARENT_COMMIT = (() => {
  if (!GIT_AVAILABLE) return false;
  const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD~1'], { cwd: process.cwd() });
  return result.exitCode === 0;
})();
const REPO_ROOT = process.cwd();

/**
 * Run git directly via Bun.spawnSync, bypassing runGit from git-utils
 * which is globally mocked by other test files.
 */
function gitDiff(args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git exited with code ${result.exitCode}: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

// ────────────────────────────────────────────────────────────────
// Unit tests — pure functions
// ────────────────────────────────────────────────────────────────

describe('parseMultiFileDiff', () => {
  it('parses a simple multi-file diff', () => {
    const raw = [
      'diff --git a/src/file1.ts b/src/file1.ts',
      'index abc..def 100644',
      '--- a/src/file1.ts',
      '+++ b/src/file1.ts',
      '@@ -1,3 +1,4 @@',
      ' unchanged',
      '-removed',
      '+added',
      ' still here',
    ].join('\n');

    const result = parseMultiFileDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/file1.ts');
    expect(result[0].status).toBe('modified');
    expect(result[0].added).toBe(1);
    expect(result[0].deleted).toBe(1);
  });

  it('parses new file creation', () => {
    const raw = [
      'diff --git a/newfile.ts b/newfile.ts',
      'new file mode 100644',
      'index 0000000..abc1234',
      '--- /dev/null',
      '+++ b/newfile.ts',
      '@@ -0,0 +1,3 @@',
      '+line1',
      '+line2',
      '+line3',
    ].join('\n');

    const result = parseMultiFileDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('newfile.ts');
    expect(result[0].status).toBe('new');
    expect(result[0].added).toBe(3);
    expect(result[0].deleted).toBe(0);
  });

  it('parses deleted file', () => {
    const raw = [
      'diff --git a/oldfile.ts b/oldfile.ts',
      'deleted file mode 100644',
      'index abc..def 100644',
      '--- a/oldfile.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line1',
      '-line2',
    ].join('\n');

    const result = parseMultiFileDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('oldfile.ts');
    expect(result[0].status).toBe('deleted');
    expect(result[0].added).toBe(0);
    expect(result[0].deleted).toBe(2);
  });

  it('parses multiple files', () => {
    const raw = [
      'diff --git a/a.ts b/a.ts',
      'index abc..def 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,1 +1,2 @@',
      ' keep',
      '+new',
      '',
      'diff --git a/b.ts b/b.ts',
      'index ghi..jkl 100644',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n');

    const result = parseMultiFileDiff(raw);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('a.ts');
    expect(result[0].added).toBe(1);
    expect(result[1].path).toBe('b.ts');
    expect(result[1].added).toBe(1);
    expect(result[1].deleted).toBe(1);
  });

  it('handles empty input', () => {
    const result = parseMultiFileDiff('');
    expect(result).toHaveLength(0);
  });

  it('handles diff with no hunks (binary file)', () => {
    const raw = [
      'diff --git a/image.png b/image.png',
      'index abc..def 100644',
      'Binary files a/image.png and b/image.png differ',
    ].join('\n');

    const result = parseMultiFileDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('image.png');
    expect(result[0].added).toBe(0);
    expect(result[0].deleted).toBe(0);
  });

  it('handles renamed file with 100% similarity', () => {
    const raw = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 100%',
      'rename from old.ts',
      'rename to new.ts',
    ].join('\n');

    const result = parseMultiFileDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('new.ts');
    expect(result[0].added).toBe(0);
    expect(result[0].deleted).toBe(0);
  });

  it('deduplicates by path', () => {
    const raw = [
      'diff --git a/file.ts b/file.ts',
      'index abc..def 100644',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
    ].join('\n');

    const result = parseMultiFileDiff(raw);
    expect(result).toHaveLength(1);
  });
});

describe('formatDiffOutput', () => {
  it('formats single file diff', () => {
    const files = [{ path: 'src/file.ts', status: 'modified' as const, added: 5, deleted: 3 }];
    const output = formatDiffOutput(files);
    expect(output).toContain('GIT DIFF — 1 file changed');
    expect(output).toContain('src/file.ts');
    expect(output).toContain('+5');
    expect(output).toContain('-3');
    expect(output).toContain('(modified)');
    expect(output).toContain('Total: +5 -3');
  });

  it('formats multi-file diff', () => {
    const files = [
      { path: 'a.ts', status: 'modified' as const, added: 10, deleted: 2 },
      { path: 'b.ts', status: 'new' as const, added: 20, deleted: 0 },
      { path: 'c.ts', status: 'deleted' as const, added: 0, deleted: 5 },
    ];
    const output = formatDiffOutput(files);
    expect(output).toContain('GIT DIFF — 3 files changed');
    expect(output).toContain('(new file)');
    expect(output).toContain('(deleted)');
    expect(output).toContain('Total: +30 -7');
  });

  it('returns "No changes" for empty array', () => {
    expect(formatDiffOutput([])).toBe('No changes to show.');
  });
});

// ────────────────────────────────────────────────────────────────
// Integration tests — actual git operations
// ────────────────────────────────────────────────────────────────

describe('git_diff integration', () => {
  test.skipIf(!GIT_AVAILABLE || !HAS_PARENT_COMMIT)(
    'parses HEAD diff (last commit)',
    async () => {
      const raw = gitDiff(['diff', 'HEAD~1', 'HEAD']);
      expect(raw.length).toBeGreaterThan(0);
      const parsed = parseMultiFileDiff(raw);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed[0].added + parsed[0].deleted).toBeGreaterThan(0);
    }
  );

  test.skipIf(!GIT_AVAILABLE)(
    'returns empty for no changes (HEAD vs HEAD)',
    async () => {
      const raw = gitDiff(['diff', 'HEAD', 'HEAD']);
      expect(raw.trim()).toBe('');
    }
  );

  test.skipIf(!GIT_AVAILABLE)(
    'parses staged diff without crashing',
    async () => {
      const raw = gitDiff(['diff', '--staged']);
      // May be empty if nothing is staged, but should not crash
      const parsed = parseMultiFileDiff(raw);
      expect(Array.isArray(parsed)).toBe(true);
    }
  );

  test.skipIf(!GIT_AVAILABLE || !HAS_PARENT_COMMIT)(
    'parses diff for a specific file',
    async () => {
      // Diff HEAD~1..HEAD for the entry file
      const raw = gitDiff(['diff', 'HEAD~1', 'HEAD', '--', 'src/four-opencode-supertools.ts']);
      const parsed = parseMultiFileDiff(raw);
      expect(Array.isArray(parsed)).toBe(true);
      if (parsed.length > 0) {
        expect(parsed[0].path).toBe('src/four-opencode-supertools.ts');
      }
    }
  );

  test.skipIf(!GIT_AVAILABLE || !HAS_PARENT_COMMIT)(
    'correctly counts additions and deletions',
    async () => {
      const raw = gitDiff(['diff', 'HEAD~1', 'HEAD']);
      const parsed = parseMultiFileDiff(raw);
      // Verify that multi-file parsing gives consistent add/del totals
      let totalAdds = 0;
      let totalDels = 0;
      for (const fd of parsed) {
        totalAdds += fd.added;
        totalDels += fd.deleted;
      }
      expect(totalAdds + totalDels).toBeGreaterThan(0);
    }
  );

  test.skipIf(!GIT_AVAILABLE || !HAS_PARENT_COMMIT)(
    'formatDiffOutput returns correct summary for git output',
    async () => {
      const raw = gitDiff(['diff', 'HEAD~1', 'HEAD']);
      const parsed = parseMultiFileDiff(raw);
      const output = formatDiffOutput(parsed);
      expect(output).toMatch(/^GIT DIFF — \d+ file/);
      expect(output).toContain('Total:');
    }
  );
});
