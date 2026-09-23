// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseGitStatus,
  formatGitStatus,
  parseRemote,
  repoNameFromRemoteUrl,
  gitStatusTool,
  type GitStatusParsed,
} from '../src/tools/git-status';

const GIT_AVAILABLE = Bun.which('git') !== null;

// ────────────────────────────────────────────────────────────────
// Fixtures (porcelain v2 strings — no repo required)
// ────────────────────────────────────────────────────────────────

const OID = '7a760f7778bc092138a0c608a23156a5b912430d';

function parsedWith(overrides: Partial<GitStatusParsed> = {}): GitStatusParsed {
  return {
    branch: 'main',
    detached: false,
    oid: OID,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    noCommits: false,
    counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
    paths: [],
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────
// Parser unit tests
// ────────────────────────────────────────────────────────────────

describe('parseGitStatus', () => {
  it('parses a clean tree with upstream and ahead/behind', () => {
    const raw = [
      `# branch.oid ${OID}`,
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +0 -0',
    ].join('\n');

    const p = parseGitStatus(raw);
    expect(p.branch).toBe('main');
    expect(p.detached).toBe(false);
    expect(p.oid).toBe(OID);
    expect(p.upstream).toBe('origin/main');
    expect(p.ahead).toBe(0);
    expect(p.behind).toBe(0);
    expect(p.noCommits).toBe(false);
    expect(p.counts).toEqual({ staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
    expect(p.paths).toEqual([]);
  });

  it('reports the short OID on a detached HEAD', () => {
    const raw = [`# branch.oid ${OID}`, '# branch.head (detached)'].join('\n');

    const p = parseGitStatus(raw);
    expect(p.detached).toBe(true);
    expect(p.branch).toBe(OID.slice(0, 7));
    expect(p.upstream).toBeNull();
    expect(p.ahead).toBeNull();
  });

  it('reports null upstream when none is configured', () => {
    const raw = [`# branch.oid ${OID}`, '# branch.head main'].join('\n');

    const p = parseGitStatus(raw);
    expect(p.branch).toBe('main');
    expect(p.upstream).toBeNull();
    expect(p.ahead).toBeNull();
    expect(p.behind).toBeNull();
  });

  it('parses ahead and behind counts', () => {
    const raw = [
      `# branch.oid ${OID}`,
      '# branch.head feat/x',
      '# branch.upstream origin/feat/x',
      '# branch.ab +2 -3',
    ].join('\n');

    const p = parseGitStatus(raw);
    expect(p.ahead).toBe(2);
    expect(p.behind).toBe(3);
  });

  it('counts staged, unstaged and both from XY', () => {
    const raw = [
      `# branch.oid ${OID}`,
      '# branch.head main',
      '1 M. N... 100644 100644 100644 aaa bbb staged.ts',
      '1 .M N... 100644 100644 100644 aaa bbb unstaged.ts',
      '1 MM N... 100644 100644 100644 aaa bbb both.ts',
    ].join('\n');

    const p = parseGitStatus(raw);
    expect(p.counts.staged).toBe(2);
    expect(p.counts.unstaged).toBe(2);
    expect(p.counts.untracked).toBe(0);
    expect(p.paths).toEqual(['staged.ts', 'unstaged.ts', 'both.ts']);
  });

  it('counts renames (`2` lines) and keeps the new path', () => {
    const raw = [
      `# branch.oid ${OID}`,
      '# branch.head main',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts',
      '2 RM N... 100644 100644 100644 aaa bbb R100 new2.ts\told2.ts',
    ].join('\n');

    const p = parseGitStatus(raw);
    expect(p.counts.staged).toBe(2);
    expect(p.counts.unstaged).toBe(1);
    expect(p.counts.untracked).toBe(0);
    // Current path precedes the TAB; origPath follows it.
    expect(p.paths).toEqual(['new.ts', 'new2.ts']);
  });

  it('counts conflicts (`u` lines) separately', () => {
    const raw = [
      `# branch.oid ${OID}`,
      '# branch.head main',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conf.txt',
    ].join('\n');

    const p = parseGitStatus(raw);
    expect(p.counts.conflicted).toBe(1);
    expect(p.counts.staged).toBe(0);
    expect(p.counts.unstaged).toBe(0);
    expect(p.counts.untracked).toBe(0);
    expect(p.paths).toEqual(['conf.txt']);
  });

  it('counts untracked-only (`?` lines)', () => {
    const raw = [
      `# branch.oid ${OID}`,
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +0 -0',
      '? a.txt',
      '? dir/b.txt',
    ].join('\n');

    const p = parseGitStatus(raw);
    expect(p.counts).toEqual({ staged: 0, unstaged: 0, untracked: 2, conflicted: 0 });
    expect(p.paths).toEqual(['a.txt', 'dir/b.txt']);
  });

  it('handles an empty repo (no commits yet)', () => {
    const raw = ['# branch.oid (initial)', '# branch.head main', '? u.txt'].join('\n');

    const p = parseGitStatus(raw);
    expect(p.noCommits).toBe(true);
    expect(p.oid).toBeNull();
    expect(p.branch).toBe('main');
    expect(p.upstream).toBeNull();
    expect(p.ahead).toBeNull();
    expect(p.behind).toBeNull();
    expect(p.counts.untracked).toBe(1);
  });

  it('preserves spaces in ordinary paths', () => {
    const raw = [
      `# branch.oid ${OID}`,
      '# branch.head main',
      '1 .M N... 100644 100644 100644 aaa bbb my file.txt',
    ].join('\n');

    const p = parseGitStatus(raw);
    expect(p.paths).toEqual(['my file.txt']);
  });

  it('ignores unknown record types without throwing', () => {
    const raw = ['# branch.head main', 'x whatever'].join('\n');
    const p = parseGitStatus(raw);
    expect(p.branch).toBe('main');
    expect(p.counts).toEqual({ staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
  });
});

// ────────────────────────────────────────────────────────────────
// Remote helpers
// ────────────────────────────────────────────────────────────────

describe('parseRemote / repoNameFromRemoteUrl', () => {
  it('takes the first remote from git remote -v', () => {
    const lines = [
      'origin\thttps://git.4serv.de/scr/dev-playground.git (fetch)',
      'origin\thttps://git.4serv.de/scr/dev-playground.git (push)',
    ].join('\n');

    expect(parseRemote(lines)).toEqual({
      name: 'origin',
      url: 'https://git.4serv.de/scr/dev-playground.git',
    });
  });

  it('returns null for empty remote output', () => {
    expect(parseRemote('')).toBeNull();
  });

  it('derives a repo name from https and ssh URLs', () => {
    expect(repoNameFromRemoteUrl('https://git.4serv.de/scr/dev-playground.git')).toBe(
      'dev-playground'
    );
    expect(repoNameFromRemoteUrl('git@github.com:four-bytes/four-opencode-git.git')).toBe(
      'four-opencode-git'
    );
  });
});

// ────────────────────────────────────────────────────────────────
// Formatter unit tests
// ────────────────────────────────────────────────────────────────

describe('formatGitStatus', () => {
  it('renders a clean tree', () => {
    const out = formatGitStatus(parsedWith(), '');
    expect(out).toBe(['REPO — repository', '  branch    main → origin/main (ahead 0, behind 0)', '  tree      clean'].join('\n'));
  });

  it('renders a branch with no upstream', () => {
    const out = formatGitStatus(
      parsedWith({ upstream: null, ahead: null, behind: null }),
      ''
    );
    expect(out).toContain('  branch    main (no upstream)');
    expect(out).not.toContain('ahead');
  });

  it('renders a detached HEAD with the short OID', () => {
    const out = formatGitStatus(
      parsedWith({ detached: true, branch: OID.slice(0, 7), upstream: null, ahead: null, behind: null }),
      ''
    );
    expect(out).toContain(`  branch    ${OID.slice(0, 7)} (detached)`);
  });

  it('omits the remote line when there is no remote', () => {
    const out = formatGitStatus(parsedWith(), '');
    expect(out).not.toContain('remote');
  });

  it('renders remote and repo name from git remote -v', () => {
    const lines = [
      'origin\thttps://git.4serv.de/scr/dev-playground.git (fetch)',
      'origin\thttps://git.4serv.de/scr/dev-playground.git (push)',
    ].join('\n');
    const out = formatGitStatus(parsedWith(), lines, 'fallback');
    expect(out).toContain('REPO — dev-playground');
    expect(out).toContain('  remote    origin  https://git.4serv.de/scr/dev-playground.git');
  });

  it('falls back to the given name when no remote is present', () => {
    const out = formatGitStatus(parsedWith(), '', 'my-repo');
    expect(out).toContain('REPO — my-repo');
  });

  it('renders working-tree counts', () => {
    const out = formatGitStatus(
      parsedWith({ counts: { staged: 3, unstaged: 1, untracked: 2, conflicted: 0 } }),
      ''
    );
    expect(out).toContain('  tree      3 staged, 1 unstaged, 2 untracked');
  });

  it('appends conflicted counts only when present', () => {
    const out = formatGitStatus(
      parsedWith({ counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 1 } }),
      ''
    );
    expect(out).toContain('  tree      0 staged, 0 unstaged, 0 untracked, 1 conflicted');
  });

  it('appends up to 10 changed paths when verbose', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `file${i}.ts`);
    const out = formatGitStatus(parsedWith({ paths }), '', 'repo', true);
    expect(out).toContain('  changed   file0.ts');
    expect(out).toContain('            file9.ts');
    expect(out).not.toContain('file10.ts');
    expect(out).toContain('… +2 more');
  });

  it('omits the path list when verbose is off', () => {
    const out = formatGitStatus(parsedWith({ paths: ['a.ts'] }), '');
    expect(out).not.toContain('changed');
    expect(out).not.toContain('a.ts');
  });
});

// ────────────────────────────────────────────────────────────────
// Tool surface
// ────────────────────────────────────────────────────────────────

describe('gitStatusTool', () => {
  it('is defined with a description and a verbose arg', () => {
    expect(gitStatusTool).toBeDefined();
    expect(typeof gitStatusTool.description).toBe('string');
    expect(gitStatusTool.description.length).toBeGreaterThan(0);
    expect(gitStatusTool.args.verbose).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────
// Integration test — real temp repo
// ────────────────────────────────────────────────────────────────

describe('git_status integration', () => {
  test.skipIf(!GIT_AVAILABLE)('parses a real repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'four-git-status-'));
    try {
      const run = (args: string[]): string => {
        const result = Bun.spawnSync(['git', ...args], {
          cwd: dir,
          env: { ...process.env },
        });
        if (result.exitCode !== 0) {
          throw new Error(
            `git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`
          );
        }
        return result.stdout.toString().trim();
      };

      run(['init', '-q']);
      run(['config', 'user.email', 'test@example.com']);
      run(['config', 'user.name', 'Test']);
      writeFileSync(join(dir, 'a.txt'), 'a\n');
      run(['add', '.']);
      run(['commit', '-qm', 'init']);
      run(['remote', 'add', 'origin', 'https://example.com/foo/bar.git']);

      // One staged modification + one untracked file.
      writeFileSync(join(dir, 'a.txt'), 'a\nb\n');
      run(['add', 'a.txt']);
      writeFileSync(join(dir, 'new.txt'), 'n\n');

      const raw = run(['status', '--porcelain=v2', '--branch', '--untracked-files=normal']);
      const remoteLines = run(['remote', '-v']);

      const parsed = parseGitStatus(raw);
      expect(parsed.branch.length).toBeGreaterThan(0);
      expect(parsed.upstream).toBeNull();
      expect(parsed.counts.staged).toBe(1);
      expect(parsed.counts.untracked).toBe(1);

      const out = formatGitStatus(parsed, remoteLines, 'fallback-name', true);
      expect(out).toContain('REPO — bar');
      expect(out).toContain('  remote    origin  https://example.com/foo/bar.git');
      expect(out).toContain('1 staged, 0 unstaged, 1 untracked');
      expect(out).toContain('a.txt');
      expect(out).toContain('new.txt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
