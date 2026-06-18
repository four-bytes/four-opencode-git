// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

/**
 * Shared git utility functions for all git-history analytics tools.
 * Merges git-runner, git-log-parser, and git-blame-parser into one module.
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface FileChange {
  path: string;
  added: number;
  deleted: number;
}

export interface Commit {
  hash: string;
  author: string;
  date: string; // ISO 8601
  files: FileChange[];
}

export interface BlameLine {
  line: number;
  author: string;
  commit: string;
}

// ────────────────────────────────────────────────────────────────
// 1a. runGit — execute a git command via Bun.spawn
// ────────────────────────────────────────────────────────────────

/**
 * Run a git command and return trimmed stdout.
 * Throws on non-zero exit with stderr message.
 * Handles git-not-installed and not-a-repo errors gracefully.
 */
export async function runGit(args: string[], cwd: string, _timeout = 30000): Promise<string> {
  let proc;
  try {
    proc = Bun.spawn(['git', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('No such file') || msg.includes('not found') || msg.includes('ENOENT')) {
      throw new Error('git is not installed or not found in PATH', { cause: err });
    }
    throw new Error(`Failed to spawn git: ${msg}`, { cause: err });
  }

  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    const trimmed = stderr.trim();
    if (trimmed.includes('not a git repository')) {
      throw new Error('Not a git repository (or any parent up to mount point)');
    }
    if (trimmed.includes('does not have any commits')) {
      throw new Error('Git repository has no commits yet');
    }
    throw new Error(`git exited with code ${exitCode}: ${trimmed || '(no stderr)'}`);
  }

  return (await new Response(proc.stdout).text()).trim();
}

// ────────────────────────────────────────────────────────────────
// 1b. parseGitLog — parse git log into structured Commits
// ────────────────────────────────────────────────────────────────

/**
 * Parse `git log` output into structured Commit objects.
 * Uses `git log --numstat --format='%H|%an|%aI'` for machine-readable output.
 *
 * @param cwd — Working directory (repo root)
 * @param since Optional date filter (e.g., '90d', '2024-01-01', '6 months ago')
 * @param until Optional upper bound date filter (e.g., '90 days ago')
 */
export async function parseGitLog(cwd: string, since?: string, until?: string): Promise<Commit[]> {
  const args = ['log', '--numstat', '--format=%H|%an|%aI'];

  if (since) {
    args.push(`--since=${since}`);
  }
  if (until) {
    args.push(`--until=${until}`);
  }

  const output = await runGit(args, cwd);
  return parseLogOutput(output);
}

/**
 * Parse the raw output of `git log --numstat --format='%H|%an|%aI'`.
 * Exported for testing.
 *
 * Output format:
 *   HASH|AUTHOR|DATE
 *   (blank line — separator between header and numstat)
 *   added\tdeleted\tpath
 *   ...
 *   (blank line before next commit)
 *   HASH|AUTHOR|DATE
 *   ...
 */
export function parseLogOutput(raw: string): Commit[] {
  const commits: Commit[] = [];
  let currentCommit: Commit | null = null;

  const lines = raw.split('\n');

  for (const line of lines) {
    // Check if this is a commit header line: HASH|AUTHOR|DATE
    // Hash is exactly 40 hex chars, followed by |author|ISO-date
    const headerMatch = line.match(/^([0-9a-f]{40})\|([^|]+)\|(.+)$/);
    if (headerMatch) {
      // Save previous commit before starting new one
      if (currentCommit) {
        commits.push(currentCommit);
      }
      currentCommit = {
        hash: headerMatch[1]!,
        author: headerMatch[2]!,
        date: headerMatch[3]!,
        files: [],
      };
      continue;
    }

    // Skip blank lines (separators)
    if (line.trim() === '') {
      continue;
    }

    // Otherwise it's a numstat file line: added\tdeleted\tpath
    if (currentCommit) {
      const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (match) {
        const added = match[1] === '-' ? 0 : parseInt(match[1], 10);
        const deleted = match[2] === '-' ? 0 : parseInt(match[2], 10);
        const path = match[3]!;
        currentCommit.files.push({ path, added, deleted });
      }
    }
  }

  // Don't forget the last commit
  if (currentCommit) {
    commits.push(currentCommit);
  }

  return commits;
}

// ────────────────────────────────────────────────────────────────
// 1c. getFileList — list tracked files excluding noise
// ────────────────────────────────────────────────────────────────

/**
 * Get filtered list of tracked files via `git ls-files`.
 * Excludes lockfiles, changelogs, CI configs, dist/, node_modules, minified files.
 */
export async function getFileList(cwd: string): Promise<string[]> {
  const output = await runGit(['ls-files'], cwd);
  return output.split('\n').filter((f) => f.trim() !== '' && !isExcluded(f));
}

// ────────────────────────────────────────────────────────────────
// 1d. isExcluded — filter noise files from analysis
// ────────────────────────────────────────────────────────────────

/**
 * Filter out files that shouldn't be analyzed for ownership/coupling.
 * Excludes lockfiles, changelogs, CI configs, dist/, node_modules, minified files,
 * and binary files (detected by `-` in added/deleted numstat).
 */
export function isExcluded(file: string): boolean {
  // Lockfiles
  if (/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock|bun\.lockb)$/.test(file)) {
    return true;
  }

  // Changelogs
  if (/^(CHANGELOG\.md|HISTORY\.md)$/.test(file)) return true;
  if (/\.changelog/i.test(file)) return true;

  // CI configs
  if (/^\.github\/workflows\/.*\.yml$/.test(file)) return true;
  if (file === '.github/dependabot.yml') return true;

  // Generated / vendor directories
  if (file.startsWith('dist/') || file.startsWith('node_modules/') || file.startsWith('.git/')) {
    return true;
  }

  // Minified files
  if (/\.min\.(js|css)$/.test(file)) return true;

  return false;
}

// ────────────────────────────────────────────────────────────────
// 1e & 1f. parseGitBlame / parseGitBlameForDir
// ────────────────────────────────────────────────────────────────

/**
 * Parse `git blame --line-porcelain` for a single file.
 * Returns an array of BlameLine, one per line of the file.
 */
export async function parseGitBlame(filePath: string, cwd?: string): Promise<BlameLine[]> {
  const workDir = cwd ?? process.cwd();
  try {
    const output = await runGit(['blame', '--line-porcelain', '--', filePath], workDir);
    return parseBlameOutput(output);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If the file doesn't exist in git, return empty array
    if (msg.includes('no such path') || msg.includes('exists on disk, but not in')) {
      return [];
    }
    throw err;
  }
}

/**
 * Parse `git blame --line-porcelain` for all tracked files in a directory.
 * Returns a Map of file path → blame lines.
 */
export async function parseGitBlameForDir(
  dirPath: string,
  cwd?: string
): Promise<Map<string, BlameLine[]>> {
  const workDir = cwd ?? process.cwd();
  const result = new Map<string, BlameLine[]>();

  // Get all tracked files in the directory
  let fileList: string;
  try {
    fileList = await runGit(['ls-files', '--', dirPath], workDir);
  } catch {
    return result;
  }

  const files = fileList.split('\n').filter((f) => f.trim() !== '');

  for (const file of files) {
    const blame = await parseGitBlame(file, workDir);
    if (blame.length > 0) {
      result.set(file, blame);
    }
  }

  return result;
}

/**
 * Parse the raw output of `git blame --line-porcelain`.
 * The porcelain format emits:
 *   - A header line per commit: COMMIT_HASH ORIG_LINE FINAL_LINE [GROUP_SIZE]
 *   - Then "pseudo-headers" prefixed with a space and field name
 *   - Then the actual line content prefixed with a tab
 *
 * Exported for testing.
 */
export function parseBlameOutput(raw: string): BlameLine[] {
  const lines: BlameLine[] = [];
  const allLines = raw.split('\n');

  let currentLineNum = 0;
  let currentCommit = '';
  let currentAuthor = '';

  for (const line of allLines) {
    // Header line: <40-char-hex> <orig-line> <final-line> [group-size]
    const headerMatch = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/);
    if (headerMatch) {
      currentCommit = headerMatch[1]!;
      currentLineNum = parseInt(headerMatch[3]!, 10);
      // Reset for new entry
      currentAuthor = '';
      continue;
    }

    // Pseudo-header: space-prefixed field
    if (line.startsWith('author ')) {
      currentAuthor = line.slice('author '.length);
      continue;
    }

    // Tab-prefixed line is the actual file content
    if (line.startsWith('\t')) {
      if (currentLineNum > 0) {
        lines.push({
          line: currentLineNum,
          author: currentAuthor,
          commit: currentCommit,
        });
        currentLineNum++; // increment for group lines
      }
      continue;
    }

    // Other pseudo-headers are ignored
  }

  return lines;
}
