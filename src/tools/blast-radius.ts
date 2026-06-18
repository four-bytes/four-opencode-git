// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { parseGitLog, parseGitBlame, type Commit } from '../lib/git-utils';
import { logDebugEvent } from '../lib/debug-logger';

/**
 * BLAST RADIUS — weighted scoring algorithm.
 *
 * Given file F:
 * 1. Find implicitly coupled files (threshold 0.5) — coupling logic inline
 * 2. Find files with same dominant author (from blame)
 * 3. Find files in same directory changed in last 90 days
 * 4. Compute risk_score for each related file:
 *    risk = (coupling_strength × 0.5) + (author_overlap × 0.3) + (directory_proximity × 0.2)
 * 5. Return combined report, sorted by risk_score
 */

interface BlastEntry {
  file: string;
  riskScore: number;
  couplingStrength: number;
  reasonType: string; // coupling, shared-author, same-directory
  detail: string;
}

export const blastRadiusTool = tool({
  description:
    'Given a file, find everything that might break when you touch it — coupled files, shared authors, related modules. Uses weighted scoring.',

  args: {
    file: tool.schema.string().describe('File path relative to repo root to analyze'),
    since: tool.schema.string().describe("Only consider commits since date (e.g., '90d', '6m')"),
  },

  async execute(args, ctx) {
    const targetFile = args.file as string;
    const since = args.since as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('blast_radius.start', { file: targetFile, since: since ?? 'none' });

    try {
      const result = await computeBlastRadius(targetFile, cwd, since);
      logDebugEvent('blast_radius.done', { entries: result.length });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('blast_radius.error', { error: msg });
      return `Error computing blast radius: ${msg}`;
    }
  },
});

/**
 * Compute blast radius for a target file.
 */
export async function computeBlastRadius(
  targetFile: string,
  cwd: string,
  since?: string
): Promise<string> {
  // Get commits for coupling analysis
  const commits = await parseGitLog(cwd, since);

  // Check if file exists in git history
  const targetCommits = commits.filter((c) => c.files.some((f) => f.path === targetFile));
  if (targetCommits.length === 0) {
    return `File not found in git history: ${targetFile}`;
  }

  // 1. Build implicit coupling pairs (threshold 0.5)
  const couplings = computeCouplingInternal(commits, 0.5);
  const couplingMap = new Map<string, number>();
  for (const c of couplings) {
    if (c.files[0] === targetFile) {
      couplingMap.set(c.files[1], c.couplingStrength);
    } else if (c.files[1] === targetFile) {
      couplingMap.set(c.files[0], c.couplingStrength);
    }
  }

  // 2. Find dominant author via blame
  let dominantAuthor = '';
  let dominantAuthorPct = 0;
  try {
    const blameLines = await parseGitBlame(targetFile, cwd);
    if (blameLines.length > 0) {
      const authorCounts = new Map<string, number>();
      for (const bl of blameLines) {
        if (bl.author && bl.author !== 'Not Committed Yet') {
          authorCounts.set(bl.author, (authorCounts.get(bl.author) ?? 0) + 1);
        }
      }
      const total = Array.from(authorCounts.values()).reduce((s, n) => s + n, 0);
      let topCount = 0;
      for (const [author, count] of authorCounts) {
        if (count > topCount) {
          dominantAuthor = author;
          topCount = count;
        }
      }
      dominantAuthorPct = total > 0 ? topCount / total : 0;
    }
  } catch {
    // Blame may fail for some files; continue without it
  }

  // Build list of files by same author (from commit log)
  const sameAuthorFiles = new Set<string>();
  if (dominantAuthor) {
    for (const commit of commits) {
      if (commit.author === dominantAuthor) {
        for (const f of commit.files) {
          if (f.path !== targetFile && !couplingMap.has(f.path)) {
            sameAuthorFiles.add(f.path);
          }
        }
      }
    }
  }

  // 3. Files in same directory, changed in last 90 days
  const targetDir = targetFile.includes('/')
    ? targetFile.slice(0, targetFile.lastIndexOf('/'))
    : '.';
  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  const sameDirFiles = new Set<string>();
  const recentFiles = new Set<string>();
  for (const commit of commits) {
    const commitDate = new Date(commit.date).getTime();
    if (now - commitDate > ninetyDaysMs) continue;
    for (const f of commit.files) {
      if (f.path === targetFile) continue;
      if (couplingMap.has(f.path) || sameAuthorFiles.has(f.path)) continue;
      const fDir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
      if (fDir === targetDir) {
        sameDirFiles.add(f.path);
      } else if (
        targetDir !== '.' &&
        fDir !== '.' &&
        (fDir.startsWith(targetDir + '/') || targetDir.startsWith(fDir + '/'))
      ) {
        sameDirFiles.add(f.path);
      }
    }
    for (const f of commit.files) {
      recentFiles.add(f.path);
    }
  }

  // 4. Compute weighted risk scores
  const entries: Map<string, BlastEntry> = new Map();

  // Helper to add/merge entries
  function addEntry(
    file: string,
    couplingScore: number,
    authorScore: number,
    dirScore: number,
    reasonParts: string[]
  ) {
    const existing = entries.get(file);
    const riskScore = couplingScore * 0.5 + authorScore * 0.3 + dirScore * 0.2;

    if (existing) {
      existing.riskScore = Math.max(existing.riskScore, riskScore);
      existing.couplingStrength = Math.max(existing.couplingStrength, couplingScore);
      // Merge reason
      if (reasonParts.length > 0) {
        existing.detail = reasonParts.join(' + ');
      }
    } else {
      const reasonType =
        couplingScore > 0.5 ? 'coupling' : authorScore > 0 ? 'shared-author' : 'same-directory';
      entries.set(file, {
        file,
        riskScore,
        couplingStrength: couplingScore,
        reasonType,
        detail: reasonParts.join(' + '),
      });
    }
  }

  // Coupled files
  for (const [file, strength] of couplingMap) {
    const dirScore = sameDirFiles.has(file) ? 1.0 : 0.0;
    const isParent =
      targetDir !== '.' &&
      file.includes('/') &&
      (file.startsWith(targetDir + '/') ||
        targetDir.startsWith(file.slice(0, file.lastIndexOf('/')) + '/'));
    const dirProx = dirScore || (isParent ? 0.5 : 0.0);
    const reasonParts = [`coupling (${strength.toFixed(2)})`];
    if (dirProx > 0) reasonParts.push('same directory');
    addEntry(file, strength, 0, dirProx, reasonParts);
  }

  // Same-author files
  for (const file of sameAuthorFiles) {
    const dirProx = sameDirFiles.has(file) ? 1.0 : 0.5;
    const reasonParts = [
      `shared author (${dominantAuthor}, ${Math.round(dominantAuthorPct * 100)}% owner)`,
    ];
    if (dirProx >= 1.0) reasonParts.push('same directory');
    addEntry(file, 0, dominantAuthorPct, dirProx, reasonParts);
  }

  // Same-directory files (not already covered)
  for (const file of sameDirFiles) {
    if (couplingMap.has(file) || sameAuthorFiles.has(file)) continue;
    addEntry(file, 0, 0, 1.0, ['same directory']);
  }

  // Sort by risk_score descending
  const sorted = Array.from(entries.values()).sort((a, b) => b.riskScore - a.riskScore);

  // Format output
  const lines: string[] = [];
  lines.push(`BLAST RADIUS — ${targetFile}`);

  if (sorted.length === 0) {
    lines.push('  No related files found.');
    return lines.join('\n');
  }

  // Header
  lines.push('  Risk score | File                          | Reason');

  for (const e of sorted) {
    const scoreStr = e.riskScore.toFixed(2).padStart(10);
    const fileStr = e.file.padEnd(30);
    lines.push(`  ${scoreStr} | ${fileStr} | ${e.detail}`);
  }

  return lines.join('\n');
}

/**
 * Internal coupling computation (reused from implicit-coupling logic).
 * Using threshold 0.5 for blast radius.
 */
function computeCouplingInternal(
  commits: Commit[],
  threshold: number
): { files: [string, string]; couplingStrength: number }[] {
  const pairCounts = new Map<string, number>();
  const fileTotalCommits = new Map<string, number>();

  for (const commit of commits) {
    const changedFiles = commit.files.map((f) => f.path);
    if (changedFiles.length < 2) continue;

    for (const file of changedFiles) {
      fileTotalCommits.set(file, (fileTotalCommits.get(file) ?? 0) + 1);
    }

    for (let i = 0; i < changedFiles.length; i++) {
      for (let j = i + 1; j < changedFiles.length; j++) {
        const a = changedFiles[i]!;
        const b = changedFiles[j]!;
        const key = a < b ? `${a}|||${b}` : `${b}|||${a}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const results: { files: [string, string]; couplingStrength: number }[] = [];
  for (const [key, count] of pairCounts) {
    const [fileA, fileB] = key.split('|||') as [string, string];
    const maxCommits = Math.max(fileTotalCommits.get(fileA) ?? 0, fileTotalCommits.get(fileB) ?? 0);
    if (maxCommits === 0) continue;
    const strength = Math.round((count / maxCommits) * 1000) / 1000;
    if (strength >= threshold) {
      results.push({ files: [fileA, fileB], couplingStrength: strength });
    }
  }
  results.sort((a, b) => b.couplingStrength - a.couplingStrength);
  return results;
}
