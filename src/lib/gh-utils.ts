// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

/**
 * Shared GitHub CLI utility functions for all gh_* tools.
 * Wraps `gh` CLI commands with error handling and repo resolution.
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface GhExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ────────────────────────────────────────────────────────────────
// 1. runGh — execute a gh CLI command via Bun.spawn
// ────────────────────────────────────────────────────────────────

/**
 * Run a `gh` CLI command and return trimmed stdout.
 * Throws on non-zero exit with descriptive error messages.
 * Handles gh-not-installed, not-authenticated, and 404 errors gracefully.
 */
export async function runGh(args: string[], cwd: string, _timeout = 30000): Promise<string> {
  let proc;
  try {
    proc = Bun.spawn(['gh', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('No such file') || msg.includes('not found') || msg.includes('ENOENT')) {
      throw new Error('GitHub CLI (gh) is not installed. Install from https://cli.github.com/', {
        cause: err,
      });
    }
    throw new Error(`Failed to spawn gh: ${msg}`, { cause: err });
  }

  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    const trimmed = stderr.trim();
    if (
      trimmed.includes('To authenticate') ||
      trimmed.includes('not authenticated') ||
      trimmed.includes('gh auth login')
    ) {
      throw new Error('GitHub CLI not authenticated. Run `gh auth login` first.');
    }
    // 404 detection via stderr message patterns
    if (
      trimmed.includes('Not Found') ||
      trimmed.includes('404') ||
      trimmed.includes('could not find')
    ) {
      throw new Error(`Resource not found: ${trimmed}`);
    }
    throw new Error(`gh exited with code ${exitCode}: ${trimmed || '(no stderr)'}`);
  }

  return (await new Response(proc.stdout).text()).trim();
}

// ────────────────────────────────────────────────────────────────
// 2. resolveRepo — determine the GitHub repo (owner/repo)
// ────────────────────────────────────────────────────────────────

/**
 * Resolve the current GitHub repository name in owner/repo format.
 * Uses `gh repo view --json nameWithOwner` for reliable detection.
 *
 * @param repo - Explicit repo override (e.g., "owner/repo")
 * @param cwd  - Working directory
 * @returns The repo name in owner/repo format
 */
export async function resolveRepo(repo: string | undefined, cwd: string): Promise<string> {
  if (repo) {
    // Validate format: must be owner/repo
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
      throw new Error(
        `Invalid repo format: "${repo}". Expected "owner/repo" (e.g., "four-bytes/four-opencode-supertools").`
      );
    }
    return repo;
  }

  try {
    const raw = await runGh(
      ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
      cwd
    );
    if (!raw.trim()) {
      throw new Error('Empty response from gh repo view');
    }
    return raw.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not determine current GitHub repo. Ensure you are in a git repo with a GitHub remote. ${msg}`,
      { cause: err }
    );
  }
}
