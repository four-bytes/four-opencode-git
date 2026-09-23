// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { basename } from 'node:path';
import { runGit } from '../lib/git-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface GitStatusCounts {
  /** Entries with a non-`.` index state (X). */
  staged: number;
  /** Entries with a non-`.` worktree state (Y). */
  unstaged: number;
  /** `?` entries. */
  untracked: number;
  /** `u` entries (unmerged). */
  conflicted: number;
}

export interface GitStatusParsed {
  /** Branch name, or the 7-char short OID when HEAD is detached. */
  branch: string;
  /** True when HEAD is detached (`# branch.head (detached)`). */
  detached: boolean;
  /** Full HEAD commit OID, or null in a repo with no commits yet. */
  oid: string | null;
  /** Upstream ref (e.g. `origin/main`), or null when none is configured. */
  upstream: string | null;
  /** Commits ahead of upstream, or null when there is no upstream. */
  ahead: number | null;
  /** Commits behind upstream, or null when there is no upstream. */
  behind: number | null;
  /** True when the repo has no commits yet (`# branch.oid (initial)`). */
  noCommits: boolean;
  counts: GitStatusCounts;
  /** Changed paths in porcelain order (used only for verbose output). */
  paths: string[];
}

export interface GitStatusRemote {
  /** Configured remote name, e.g. `origin`. */
  name: string;
  /** Remote fetch URL. */
  url: string;
}

// ────────────────────────────────────────────────────────────────
// Parsing — `git status --porcelain=v2 --branch`
// ────────────────────────────────────────────────────────────────

/**
 * Extract the current path from a porcelain v2 changed-entry line.
 *
 * Record layouts (fields space-separated unless noted):
 *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>
 *   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 *
 * Paths may contain spaces, so we re-join everything from the path field on.
 * For `2` records the current (new) path precedes the TAB; the TAB separates it
 * from `<origPath>` — verified against real git output, not assumed.
 */
function extractPath(line: string, kind: string): string {
  if (kind === '2') {
    const left = line.split('\t')[0] ?? line;
    return left.split(' ').slice(9).join(' ');
  }
  if (kind === 'u') {
    return line.split(' ').slice(10).join(' ');
  }
  // kind === '1'
  return line.split(' ').slice(8).join(' ');
}

/**
 * Parse `git status --porcelain=v2 --branch --untracked-files=normal`.
 * Pure — no repo access — so tests run on fixture strings.
 */
export function parseGitStatus(raw: string): GitStatusParsed {
  let branch = '';
  let detached = false;
  let oid: string | null = null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let noCommits = false;

  const counts: GitStatusCounts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  const paths: string[] = [];

  for (const line of raw.split('\n')) {
    if (line === '') continue;

    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim();
      if (value === '(detached)') detached = true;
      else branch = value;
      continue;
    }

    if (line.startsWith('# branch.oid ')) {
      const value = line.slice('# branch.oid '.length).trim();
      if (value === '(initial)') {
        noCommits = true;
        oid = null;
      } else {
        oid = value;
      }
      continue;
    }

    if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length).trim() || null;
      continue;
    }

    if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        ahead = parseInt(m[1]!, 10);
        behind = parseInt(m[2]!, 10);
      }
      continue;
    }

    // Any other header (`# branch.*`, future additions) is ignored.
    if (line.startsWith('#')) continue;

    const kind = line[0];

    if (kind === '1' || kind === '2' || kind === 'u') {
      // XY is positional: X = index state, Y = worktree state, `.` = clean.
      const xy = line.slice(2, 4);
      const x = xy[0] ?? '.';
      const y = xy[1] ?? '.';

      if (kind === 'u') {
        // Unmerged entries are counted on their own, never as staged/unstaged.
        counts.conflicted++;
      } else {
        if (x !== '.') counts.staged++;
        if (y !== '.') counts.unstaged++;
      }

      const path = extractPath(line, kind);
      if (path) paths.push(path);
      continue;
    }

    if (kind === '?') {
      counts.untracked++;
      const path = line.slice(2);
      if (path) paths.push(path);
      continue;
    }

    // Unknown record type — ignore rather than throw.
  }

  // Detached HEAD has no branch name; report the short OID instead.
  if (detached) {
    branch = (oid ?? '').slice(0, 7);
  }

  return { branch, detached, oid, upstream, ahead, behind, noCommits, counts, paths };
}

// ────────────────────────────────────────────────────────────────
// Remote + repo name
// ────────────────────────────────────────────────────────────────

/**
 * Take the first fetch remote from `git remote -v` output.
 * Returns null when the output is empty (no remote configured).
 */
export function parseRemote(remoteLines: string): GitStatusRemote | null {
  for (const line of remoteLines.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // "<name>\t<url> (fetch|push)"
    const parts = trimmed.split(/\s+/);
    const name = parts[0];
    const url = parts[1];
    if (!name || !url) continue;
    return { name, url };
  }
  return null;
}

/**
 * Derive a repository name from a remote URL basename, stripping a `.git` suffix.
 * Handles both `https://host/owner/repo.git` and `git@host:owner/repo.git`.
 */
export function repoNameFromRemoteUrl(url: string): string | null {
  const cleaned = url.replace(/\/+$/, '');
  const base = cleaned.split(/[/:]/).pop() ?? '';
  const name = base.replace(/\.git$/, '');
  return name || null;
}

// ────────────────────────────────────────────────────────────────
// Formatting
// ────────────────────────────────────────────────────────────────

const LABEL_WIDTH = 8;
const VALUE_INDENT = 12;

function label(name: string): string {
  return `  ${name.padEnd(LABEL_WIDTH)}  `;
}

/**
 * Render the fixed ~4-line orientation block.
 *
 * @param parsed          Result of {@link parseGitStatus}.
 * @param remoteLines     Raw `git remote -v` output, or '' when unavailable.
 * @param fallbackRepoName Used when no remote URL is present (default `repository`).
 * @param verbose         Append up to 10 changed paths (default off).
 */
export function formatGitStatus(
  parsed: GitStatusParsed,
  remoteLines: string,
  fallbackRepoName = 'repository',
  verbose = false
): string {
  const remote = parseRemote(remoteLines);
  const repoName = (remote && repoNameFromRemoteUrl(remote.url)) || fallbackRepoName;

  const lines: string[] = [`REPO — ${repoName}`];

  // branch
  if (parsed.upstream) {
    let suffix = '';
    if (parsed.ahead !== null && parsed.behind !== null) {
      suffix = ` (ahead ${parsed.ahead}, behind ${parsed.behind})`;
    }
    lines.push(`${label('branch')}${parsed.branch} → ${parsed.upstream}${suffix}`);
  } else if (parsed.detached) {
    lines.push(`${label('branch')}${parsed.branch} (detached)`);
  } else {
    lines.push(`${label('branch')}${parsed.branch} (no upstream)`);
  }

  // remote (omitted entirely when none is configured)
  if (remote) {
    lines.push(`${label('remote')}${remote.name}  ${remote.url}`);
  }

  // tree
  const c = parsed.counts;
  const clean = c.staged === 0 && c.unstaged === 0 && c.untracked === 0 && c.conflicted === 0;
  if (clean) {
    lines.push(`${label('tree')}clean`);
  } else {
    const parts = [`${c.staged} staged`, `${c.unstaged} unstaged`, `${c.untracked} untracked`];
    if (c.conflicted > 0) parts.push(`${c.conflicted} conflicted`);
    lines.push(`${label('tree')}${parts.join(', ')}`);
  }

  // verbose path list
  if (verbose && parsed.paths.length > 0) {
    const shown = parsed.paths.slice(0, 10);
    lines.push(`${label('changed')}${shown[0]}`);
    const indent = ' '.repeat(VALUE_INDENT);
    for (const path of shown.slice(1)) {
      lines.push(`${indent}${path}`);
    }
    if (parsed.paths.length > shown.length) {
      lines.push(`${indent}… +${parsed.paths.length - shown.length} more`);
    }
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const gitStatusTool = tool({
  description:
    'Repo orientation in one call: branch, upstream, ahead/behind, remote and working-tree counts, parsed from git status --porcelain=v2. Replaces bash branch/remote/status round trips.',

  args: {
    verbose: tool.schema
      .boolean()
      .optional()
      .describe('Append up to 10 changed paths (default off)'),
  },

  async execute(args, ctx) {
    const verbose = args.verbose === true;
    const cwd = ctx.directory;

    logDebugEvent('git_status.start', { verbose, cwd });

    try {
      const raw = await runGit(
        ['status', '--porcelain=v2', '--branch', '--untracked-files=normal'],
        cwd
      );

      // Best-effort: a missing remote must not fail the whole call.
      let remoteLines = '';
      try {
        remoteLines = await runGit(['remote', '-v'], cwd);
      } catch {
        remoteLines = '';
      }

      const parsed = parseGitStatus(raw);
      return formatGitStatus(parsed, remoteLines, basename(cwd), verbose);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('git_status.error', { error: msg });
      if (/not a git repository/i.test(msg)) {
        return 'Not a git repository.';
      }
      return msg;
    }
  },
});
