// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGit } from '../lib/git-utils';
import { parseUnifiedDiff } from '../lib/diff-parse';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface FileDiffInfo {
  path: string;
  status: 'new' | 'deleted' | 'modified';
  added: number;
  deleted: number;
}

// ────────────────────────────────────────────────────────────────
// Multi-file diff parsing
// ────────────────────────────────────────────────────────────────

/**
 * Parse a multi-file unified diff output from `git diff`.
 * Splits by `diff --git` headers and computes per-file stats.
 */
function parseMultiFileDiff(rawDiff: string): FileDiffInfo[] {
  const results: FileDiffInfo[] = [];

  // Split on diff --git headers (preserving the delimiter)
  const sections = rawDiff.split(/(?=^diff --git )/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');

    // Extract file path from "diff --git a/path b/path"
    const diffHeader = lines[0];
    if (!diffHeader) continue;
    const pathMatch = diffHeader.match(/^diff --git a\/(.*?) b\/(.*)$/);
    if (!pathMatch) continue;
    // Use the "b/" path (post-image path) — more reliable for new/deleted files
    const filePath = pathMatch[2]!.trim();

    // Determine file status
    let status: 'new' | 'deleted' | 'modified' = 'modified';
    if (trimmed.includes('new file mode')) status = 'new';
    if (trimmed.includes('deleted file mode')) status = 'deleted';

    // For renamed files with 100% similarity (no content change), skip
    if (trimmed.includes('similarity index 100%')) {
      results.push({ path: filePath, status, added: 0, deleted: 0 });
      continue;
    }

    // Locate the hunk section (starts with @@)
    const hunkStart = trimmed.indexOf('@@ ');
    if (hunkStart === -1) {
      // Binary file or empty diff — no hunks
      results.push({ path: filePath, status, added: 0, deleted: 0 });
      continue;
    }

    const hunkSection = trimmed.substring(hunkStart);
    const parsed = parseUnifiedDiff(hunkSection);

    let added = 0;
    let deleted = 0;
    for (const hunk of parsed.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') added++;
        if (line.type === 'remove') deleted++;
      }
    }

    results.push({ path: filePath, status, added, deleted });
  }

  // Deduplicate by path (last wins for a given path)
  const deduped = new Map<string, FileDiffInfo>();
  for (const r of results) {
    deduped.set(r.path, r);
  }

  return Array.from(deduped.values());
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

function formatDiffOutput(files: FileDiffInfo[]): string {
  if (files.length === 0) {
    return 'No changes to show.';
  }

  const totalAdded = files.reduce((s, f) => s + f.added, 0);
  const totalDeleted = files.reduce((s, f) => s + f.deleted, 0);

  const lines: string[] = [];
  lines.push(`GIT DIFF — ${files.length} file${files.length !== 1 ? 's' : ''} changed`);

  for (const f of files) {
    const fileStr = f.path.padEnd(30);
    const addStr = `+${f.added}`.padStart(5);
    const delStr = `-${f.deleted}`.padStart(5);

    let statusStr: string;
    switch (f.status) {
      case 'new':
        statusStr = '(new file)';
        break;
      case 'deleted':
        statusStr = '(deleted)';
        break;
      default:
        statusStr = '(modified)';
    }

    lines.push(`  ${fileStr} ${addStr}  ${delStr}  ${statusStr}`);
  }

  lines.push('');
  lines.push(`Total: +${totalAdded} -${totalDeleted}`);

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const gitDiffTool = tool({
  description:
    'Get git diff as structured output. Saves ~90% tokens vs. bash → read → parse. Returns file-level summary with line counts. Complements apply_patch (produce diff → apply diff).',

  args: {
    staged: tool.schema.boolean().describe('Show staged changes (git diff --staged)'),
    file: tool.schema.string().describe('Specific file path to diff'),
    from: tool.schema.string().describe('From commit/branch/ref'),
    to: tool.schema.string().describe('To commit/branch/ref (defaults to HEAD if from is set)'),
  },

  async execute(args, ctx) {
    const staged = args.staged as boolean | undefined;
    const file = args.file as string | undefined;
    const from = args.from as string | undefined;
    const to = args.to as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('git_diff.start', { staged, file, from, to, cwd });

    try {
      // Build git diff args
      const gitArgs: string[] = ['diff'];

      if (staged) gitArgs.push('--staged');
      if (from) gitArgs.push(from);
      if (to) gitArgs.push(to);
      // Default: show changes against HEAD (working tree vs HEAD)
      if (!from && !to) gitArgs.push('HEAD');
      if (file) {
        gitArgs.push('--');
        gitArgs.push(file);
      }

      const rawDiff = await runGit(gitArgs, cwd);

      if (!rawDiff.trim()) {
        return 'No changes to show.';
      }

      const files = parseMultiFileDiff(rawDiff);
      return formatDiffOutput(files);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('git_diff.error', { error: msg });
      return `Error getting diff: ${msg}`;
    }
  },
});

// Exported for testing
export { parseMultiFileDiff, formatDiffOutput };
