// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { parseGitLog, type Commit } from '../lib/git-utils';
import { logDebugEvent } from '../lib/debug-logger';

interface CouplingResult {
  files: [string, string];
  coCommits: number;
  couplingStrength: number;
}

export const implicitCouplingTool = tool({
  description:
    'Detect files that always change together in the same commit — hidden dependencies invisible in code. Returns co-commit pairs ranked by coupling strength.',

  args: {
    threshold: tool.schema
      .number()
      .describe('Minimum co-commit rate to report (0.0–1.0, default: 0.8)'),
    since: tool.schema.string().describe("Only consider commits since date (e.g., '90d', '6m')"),
  },

  async execute(args, ctx) {
    const threshold = (args.threshold as number) ?? 0.8;
    const since = args.since as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('implicit_coupling.start', { threshold, since: since ?? 'none' });

    try {
      const commits = await parseGitLog(cwd, since);
      const results = computeCoupling(commits, threshold);
      logDebugEvent('implicit_coupling.done', { pairs: results.length });
      return formatCouplingOutput(results, threshold);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('implicit_coupling.error', { error: msg });
      return `Error computing implicit coupling: ${msg}`;
    }
  },
});

/**
 * Compute implicit coupling between files.
 * For each commit with ≥2 files, build all file pairs.
 * Count co-occurrences and compute coupling strength.
 *
 * Optimization: for repos with >500 changed files, sample top 500 most-changed files.
 */
export function computeCoupling(commits: Commit[], threshold: number): CouplingResult[] {
  // Build set of all files referenced in commits
  const fileCounts = new Map<string, number>();
  for (const commit of commits) {
    for (const f of commit.files) {
      fileCounts.set(f.path, (fileCounts.get(f.path) ?? 0) + 1);
    }
  }

  // Optimization: for repos with >500 changed files, sample top 500 most-changed files
  const MAX_FILES = 500;
  let sampledFiles: Set<string>;

  if (fileCounts.size > MAX_FILES) {
    const sorted = Array.from(fileCounts.entries()).sort((a, b) => b[1] - a[1]);
    sampledFiles = new Set(sorted.slice(0, MAX_FILES).map(([path]) => path));
  } else {
    sampledFiles = new Set(fileCounts.keys());
  }

  const pairCounts = new Map<string, { count: number; maxA: number; maxB: number }>();
  const fileTotalCommits = new Map<string, number>();

  for (const commit of commits) {
    // Filter files to sampled set
    const changedFiles = commit.files.map((f) => f.path).filter((p) => sampledFiles.has(p));

    if (changedFiles.length < 2) continue;

    // Track total commits per file
    for (const file of changedFiles) {
      fileTotalCommits.set(file, (fileTotalCommits.get(file) ?? 0) + 1);
    }

    // Build all pairs
    for (let i = 0; i < changedFiles.length; i++) {
      for (let j = i + 1; j < changedFiles.length; j++) {
        const a = changedFiles[i]!;
        const b = changedFiles[j]!;
        // Canonical ordering
        const key = a < b ? `${a}|||${b}` : `${b}|||${a}`;
        const existing = pairCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          pairCounts.set(key, {
            count: 1,
            maxA: fileTotalCommits.get(a) ?? 1,
            maxB: fileTotalCommits.get(b) ?? 1,
          });
        }
      }
    }

    // Update max counts for existing pairs
    for (const [key, data] of pairCounts) {
      const [fileA, fileB] = key.split('|||') as [string, string];
      data.maxA = fileTotalCommits.get(fileA) ?? data.maxA;
      data.maxB = fileTotalCommits.get(fileB) ?? data.maxB;
    }
  }

  // Evaluate coupling strength
  const results: CouplingResult[] = [];
  for (const [key, data] of pairCounts) {
    const [fileA, fileB] = key.split('|||') as [string, string];
    const maxCommits = Math.max(fileTotalCommits.get(fileA) ?? 0, fileTotalCommits.get(fileB) ?? 0);
    if (maxCommits === 0) continue;

    const strength = Math.round((data.count / maxCommits) * 1000) / 1000;

    if (strength >= threshold) {
      results.push({
        files: [fileA, fileB],
        coCommits: data.count,
        couplingStrength: strength,
      });
    }
  }

  results.sort((a, b) => b.couplingStrength - a.couplingStrength);
  // Limit to top 50 pairs to avoid O(n²) output
  return results.slice(0, 50);
}

/**
 * Format coupling results as plain text.
 */
function formatCouplingOutput(results: CouplingResult[], threshold: number): string {
  if (results.length === 0) {
    return `IMPLICIT COUPLING — no pairs meet the threshold of ${threshold}`;
  }

  const lines: string[] = [];
  lines.push(`IMPLICIT COUPLING — files that change together (threshold: ${threshold.toFixed(2)})`);

  for (const r of results) {
    const fileA = r.files[0];
    const fileB = r.files[1];
    const strengthStr = r.couplingStrength.toFixed(2);
    const coStr = `${r.coCommits} co-commit${r.coCommits !== 1 ? 's' : ''}`;
    lines.push(`  ${fileA} ↔ ${fileB}    ${strengthStr} (${coStr})`);
  }

  return lines.join('\n');
}
