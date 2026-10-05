// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGit } from '../lib/git-utils';
import { logDebugEvent } from '../lib/debug-logger';

interface LogEntry {
  hash: string;
  author: string;
  date: string;
  subject: string;
  files?: FileStat[];
}

interface FileStat {
  path: string;
  added: number;
  deleted: number;
}

export interface LogArgs {
  count?: number;
  author?: string;
  since?: string;
  file?: string;
  format?: string;
  pickaxe?: string;
  grepDiff?: string;
  all?: boolean;
  range?: string;
}

/**
 * Return an error string when the arg combination is invalid, else null.
 * No git call happens on the invalid path.
 */
export function validateLogArgs(a: LogArgs): string | null {
  if (a.pickaxe && a.grepDiff) {
    return 'Error: pickaxe and grep_diff are mutually exclusive';
  }
  if (a.pickaxe && a.pickaxe.startsWith('-')) {
    return 'Error: pickaxe value must not start with "-"';
  }
  if (a.range && a.range.startsWith('-')) {
    return 'Error: range value must not start with "-"';
  }
  return null;
}

/**
 * Build the `git log` argv. Values are passed as separate argv entries
 * (never a shell string). `range` is placed before `--`; `-- <file>` last.
 */
export function buildLogArgs(a: LogArgs): string[] {
  const count = a.count ?? 20;
  const formatSpec = a.all ? '%H|%an|%ai|%s%d' : '%H|%an|%ai|%s';
  const args = ['log', `--format=${formatSpec}`, `-n${count}`];
  if (a.all) args.push('--all');
  if (a.author) args.push(`--author=${a.author}`);
  if (a.since) args.push(`--since=${a.since}`);
  if (a.pickaxe) args.push(`-S${a.pickaxe}`);
  if (a.grepDiff) args.push(`-G${a.grepDiff}`);
  if (a.range) args.push(a.range);
  if (a.file) args.push('--', a.file);
  return args;
}

export const gitLogStructuredTool = tool({
  description:
    'Returns structured git log — filterable by author, date range, file pattern. Replaces multi-command bash pipelines that agents currently use.',

  args: {
    count: tool.schema.number().optional().describe('Number of commits to return (default: 20)'),
    author: tool.schema.string().optional().describe('Filter by author name'),
    since: tool.schema.string().optional().describe("Time filter (e.g., '2 weeks ago', '2024-01-01')"),
    file: tool.schema.string().optional().describe('Filter to commits touching this file'),
    format: tool.schema.string().optional().describe("Output format: 'summary' (default) or 'detailed'"),
    pickaxe: tool.schema.string().optional().describe("Show commits that add/remove the string (-S<value>)"),
    grep_diff: tool.schema.string().optional().describe('Show commits whose diff matches the regex (-G<value>); mutually exclusive with pickaxe'),
    all: tool.schema.boolean().optional().describe('Pretend all refs are listed (--all); appends ref decoration'),
    range: tool.schema.string().optional().describe("Revision range (e.g. 'main..master'); placed before --"),
  },

  async execute(args, ctx) {
    const count = (args.count as number) ?? 20;
    const author = args.author as string | undefined;
    const since = args.since as string | undefined;
    const file = args.file as string | undefined;
    const format = (args.format as string) ?? 'summary';
    const pickaxe = args.pickaxe as string | undefined;
    const grepDiff = args.grep_diff as string | undefined;
    const all = args.all === true;
    const range = args.range as string | undefined;
    const cwd = ctx.directory;

    const invalid = validateLogArgs({ count, author, since, file, format, pickaxe, grepDiff, all, range });
    if (invalid !== null) {
      logDebugEvent('git_log_structured.error', { error: invalid });
      return invalid;
    }

    logDebugEvent('git_log_structured.start', {
      count,
      author: author ?? 'none',
      since: since ?? 'none',
      file: file ?? 'none',
      format,
      pickaxe: pickaxe ?? 'none',
      grepDiff: grepDiff ?? 'none',
      all,
      range: range ?? 'none',
    });

    try {
      const logArgs = buildLogArgs({ count, author, since, file, format, pickaxe, grepDiff, all, range });
      const logOutput = await runGit(logArgs, cwd);
      const entries = parseLogOutput(logOutput);

      if (entries.length === 0) {
        return 'GIT LOG — no commits found';
      }

      // For detailed format, fetch file stats for each commit
      if (format === 'detailed') {
        for (const entry of entries) {
          try {
            const statOutput = await runGit(['show', '--stat', '--format=', entry.hash], cwd);
            entry.files = parseStatOutput(statOutput);
          } catch {
            entry.files = [];
          }
        }
      }

      logDebugEvent('git_log_structured.done', { commits: entries.length, format });
      return formatLogOutput(entries, format);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('git_log_structured.error', { error: msg });
      return `Error fetching git log: ${msg}`;
    }
  },
});

/**
 * Parse the output of `git log --format='%H|%an|%ai|%s'`.
 */
function parseLogOutput(raw: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // Format: HASH|AUTHOR|DATE|SUBJECT
    // The hash is 40 hex chars
    const match = trimmed.match(/^([0-9a-f]{40})\|([^|]+)\|([^|]+)\|(.+)$/);
    if (match) {
      entries.push({
        hash: match[1]!,
        author: match[2]!,
        date: match[3]!,
        subject: match[4]!,
      });
    }
  }

  return entries;
}

/**
 * Parse `git show --stat` output to extract file stats.
 * Format:
 *   path/to/file.ts | 5 +++--
 *   2 files changed, 5 insertions(+), 3 deletions(-)
 */
export function parseStatOutput(raw: string): FileStat[] {
  const files: FileStat[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    // Match: "path/to/file.ts | 5 +++--"
    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*([+-]*)$/);
    if (match) {
      const path = match[1]!.trim();
      const changes = parseInt(match[2]!, 10);
      const plusMinus = match[3]!;
      // Count + and - signs
      let added = 0;
      let deleted = 0;
      for (const ch of plusMinus) {
        if (ch === '+') added++;
        else if (ch === '-') deleted++;
      }
      // If we can't determine from signs, use the total as added
      if (added === 0 && deleted === 0) {
        added = changes;
      }
      files.push({ path, added, deleted });
    }
    // Also match: "path/to/file.ts | Bin 0 -> 1234 bytes" (binary)
    else if (line.match(/^\s*(.+?)\s*\|\s*Bin/)) {
      // Skip binary files
    }
    // Match: "path/to/file.ts" without | (new file with no changes shown)
    // This is less common but can happen
  }

  return files;
}

/**
 * Format log output as plain text.
 */
export function formatLogOutput(entries: LogEntry[], format: string): string {
  if (format === 'detailed') {
    return formatDetailedLog(entries);
  }
  return formatSummaryLog(entries);
}

function formatSummaryLog(entries: LogEntry[]): string {
  const lines: string[] = [];
  lines.push(`GIT LOG — last ${entries.length} commit${entries.length !== 1 ? 's' : ''}`);

  for (const e of entries) {
    const shortHash = e.hash.slice(0, 7);
    const dateStr = e.date.slice(0, 10); // just the date part
    lines.push(`  ${shortHash}  ${e.author.padEnd(10)} ${dateStr}  ${e.subject}`);
  }

  return lines.join('\n');
}

function formatDetailedLog(entries: LogEntry[]): string {
  const lines: string[] = [];
  lines.push('GIT LOG — detailed');

  for (const e of entries) {
    const shortHash = e.hash.slice(0, 7);
    const dateStr = e.date.slice(0, 10);
    lines.push(`  ${shortHash}  ${e.author.padEnd(10)} ${dateStr}`);
    lines.push(`    ${e.subject}`);

    if (e.files && e.files.length > 0) {
      const fileParts = e.files.map((f) => `${f.path} (+${f.added}, -${f.deleted})`);
      lines.push(`    Files: ${fileParts.join(', ')}`);
    }

    lines.push(''); // blank line between commits
  }

  return lines.join('\n').trimEnd();
}
