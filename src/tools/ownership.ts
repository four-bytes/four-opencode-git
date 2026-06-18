// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { parseGitBlame, parseGitBlameForDir, type BlameLine } from '../lib/git-utils';
import { statSync, existsSync } from 'node:fs';
import { logDebugEvent } from '../lib/debug-logger';
import { resolve } from 'node:path';

interface AuthorStat {
  author: string;
  lines: number;
  pct: number;
}

export const ownershipTool = tool({
  description:
    'Analyze who owns the lines alive in HEAD — per-file and per-directory author breakdown. Surfaces knowledge silos and onboarding targets.',

  args: {
    path: tool.schema
      .string()
      .describe('File or directory path relative to repo root (default: entire repo)'),
  },

  async execute(args, ctx) {
    const targetPath = (args.path as string) || '.';
    const cwd = ctx.directory;

    logDebugEvent('ownership.start', { path: targetPath });

    try {
      const result = await computeOwnership(targetPath, cwd);
      logDebugEvent('ownership.done', {});
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('ownership.error', { error: msg });
      return `Error computing ownership: ${msg}`;
    }
  },
});

/**
 * Compute author breakdown for a file or directory.
 * Returns formatted text output.
 */
export async function computeOwnership(targetPath: string, cwd: string): Promise<string> {
  const absolutePath = resolve(cwd, targetPath);

  if (!existsSync(absolutePath)) {
    return `Path not found: ${targetPath}`;
  }

  const isDir = statSync(absolutePath).isDirectory();
  const normalizedPath = targetPath === '.' ? targetPath : targetPath.replace(/\/$/, '');

  if (isDir) {
    return computeDirOwnership(normalizedPath, cwd);
  }

  return computeFileOwnership(normalizedPath, cwd);
}

/**
 * Aggregate author stats from blame lines.
 */
function aggregateAuthors(blameLines: BlameLine[]): { total: number; authors: AuthorStat[] } {
  const authorLines = new Map<string, number>();

  for (const bl of blameLines) {
    if (bl.author && bl.author !== 'Not Committed Yet') {
      authorLines.set(bl.author, (authorLines.get(bl.author) ?? 0) + 1);
    }
  }

  const total = Array.from(authorLines.values()).reduce((sum, n) => sum + n, 0);
  const authors: AuthorStat[] = [];

  for (const [author, lines] of authorLines) {
    authors.push({
      author,
      lines,
      pct: total > 0 ? Math.round((lines / total) * 1000) / 10 : 0,
    });
  }

  authors.sort((a, b) => b.lines - a.lines);

  return { total, authors };
}

async function computeFileOwnership(filePath: string, cwd: string): Promise<string> {
  const blameLines = await parseGitBlame(filePath, cwd);
  const { total, authors } = aggregateAuthors(blameLines);

  if (total === 0) {
    return 'File has no lines';
  }

  const lines: string[] = [];
  lines.push(`OWNERSHIP — ${filePath} (${total} lines)`);

  for (const a of authors) {
    const isSilo = a.pct > 80;
    const siloFlag = isSilo ? '  ⚠ KNOWLEDGE SILO' : '';
    lines.push(
      `  ${a.author.padEnd(14)} ${a.lines.toString().padStart(5)} lines (${a.pct}%)${siloFlag}`
    );
  }

  const topAuthor = authors[0];
  if (topAuthor && topAuthor.pct <= 80) {
    lines.push(`  ⚠ ${topAuthor.author} owns <80% — no knowledge silo`);
  }

  return lines.join('\n');
}

async function computeDirOwnership(dirPath: string, cwd: string): Promise<string> {
  const blameMap = await parseGitBlameForDir(dirPath, cwd);

  if (blameMap.size === 0) {
    return 'No source files in directory';
  }

  const globalAuthorLines = new Map<string, number>();
  let globalTotal = 0;
  let fileCount = 0;

  for (const [, blameLines] of blameMap) {
    const { total, authors } = aggregateAuthors(blameLines);
    for (const author of authors) {
      globalAuthorLines.set(
        author.author,
        (globalAuthorLines.get(author.author) ?? 0) + author.lines
      );
    }
    globalTotal += total;
    fileCount++;
  }

  const globalAuthors: AuthorStat[] = [];
  for (const [author, lines] of globalAuthorLines) {
    globalAuthors.push({
      author,
      lines,
      pct: globalTotal > 0 ? Math.round((lines / globalTotal) * 1000) / 10 : 0,
    });
  }
  globalAuthors.sort((a, b) => b.lines - a.lines);

  const lines: string[] = [];
  lines.push(
    `OWNERSHIP — ${dirPath === '.' ? '.' : dirPath}/ (${globalTotal.toLocaleString()} lines across ${fileCount} files)`
  );

  for (const a of globalAuthors) {
    const isSilo = a.pct > 80;
    const siloFlag = isSilo ? '  ⚠ KNOWLEDGE SILO' : '';
    lines.push(
      `  ${a.author.padEnd(12)} ${a.lines.toLocaleString().padStart(6)} lines (${a.pct}%)${siloFlag}`
    );
  }

  return lines.join('\n');
}
