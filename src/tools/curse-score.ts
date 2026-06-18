// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { parseGitLog, isExcluded, type Commit } from '../lib/git-utils';
import { logDebugEvent } from '../lib/debug-logger';

/**
 * curse_score = changes × log₂(authors + 1) × exp(-0.5 × age_years) × log₂(churn_rate + 2) × acceleration
 *
 * Where:
 * - changes = total number of commits touching this file
 * - authors = unique author count
 * - age_years = years since first commit (now - first_date) / 365.25
 * - churn_rate = changes / max(age_years, 0.25)
 * - acceleration = min(changes_in_last_90d / max(changes, 1), 3.0)
 */

interface FileStats {
  file: string;
  changes: number;
  authors: Set<string>;
  firstDate: Date;
  lastDate: Date;
  recentChanges: number; // last 90 days
}

interface CurseResult {
  file: string;
  score: number;
  authors: number;
  changes: number;
  churnRate: number;
}

export const curseScoreTool = tool({
  description:
    'Rank files by risk using curse score algorithm: changes × log₂(authors+1) × exp(-0.5×age) × log₂(churn+2) × acceleration. Returns top N most dangerous files in the repo.',

  args: {
    top: tool.schema.number().describe('Number of files to return (default: 10)'),
    since: tool.schema
      .string()
      .describe("Only consider commits since date (e.g., '90d', '6m', '2024-01-01')"),
  },

  async execute(args, ctx) {
    const top = (args.top as number) ?? 10;
    const since = args.since as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('curse_score.start', { top, since: since ?? 'none' });

    try {
      const commits = await parseGitLog(cwd, since);

      if (commits.length === 0) {
        return 'No git history found';
      }

      const results = computeCurseScores(commits, top);
      logDebugEvent('curse_score.done', { count: results.length });
      return formatCurseScoreOutput(results, top);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('curse_score.error', { error: msg });
      return `Error computing curse scores: ${msg}`;
    }
  },
});

/**
 * Build per-file statistics from commit history.
 * @param commits The parsed git log commits
 * @param referenceDate Optional reference date for recentChanges window (default: now)
 */
function buildFileStats(commits: Commit[], referenceDate?: Date): Map<string, FileStats> {
  const stats = new Map<string, FileStats>();
  const now = referenceDate ?? new Date();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  for (const commit of commits) {
    const commitDate = new Date(commit.date);
    const isRecent90d = now.getTime() - commitDate.getTime() < ninetyDaysMs;

    for (const f of commit.files) {
      // Skip binary files (added=0 and deleted=0 from `-` in numstat)
      if (isExcluded(f.path)) continue;

      let s = stats.get(f.path);
      if (!s) {
        s = {
          file: f.path,
          changes: 0,
          authors: new Set(),
          firstDate: commitDate,
          lastDate: commitDate,
          recentChanges: 0,
        };
        stats.set(f.path, s);
      }

      s.changes++;
      s.authors.add(commit.author);

      if (commitDate < s.firstDate) s.firstDate = commitDate;
      if (commitDate > s.lastDate) s.lastDate = commitDate;

      if (isRecent90d) {
        s.recentChanges++;
      }
    }
  }

  return stats;
}

/**
 * Compute curse scores for all files, returning top N.
 * @param commits The parsed git log commits
 * @param topN Number of files to return
 * @param referenceDate Optional reference date for curse score calculation (default: now)
 */
export function computeCurseScores(
  commits: Commit[],
  topN: number,
  referenceDate?: Date
): CurseResult[] {
  const stats = buildFileStats(commits, referenceDate);
  const now = referenceDate ?? new Date();
  const yearMs = 365.25 * 24 * 60 * 60 * 1000;

  const results: CurseResult[] = [];

  for (const [, s] of stats) {
    // changes: total commits touching this file
    const changes = s.changes;
    // authors: unique author count
    const authors = s.authors.size;
    // age_years: years since first commit
    const ageYears = (now.getTime() - s.firstDate.getTime()) / yearMs;
    const clampedAge = Math.max(ageYears, 0.25);
    // churn_rate = changes / max(age_years, 0.25)
    const churnRate = changes / clampedAge;
    // acceleration = min(changes_in_last_90d / max(changes, 1), 3.0)
    const acceleration = Math.min(s.recentChanges / Math.max(changes, 1), 3.0);

    // curse_score = changes × log₂(authors + 1) × exp(-0.5 × age_years) × log₂(churn_rate + 2) × acceleration
    const score =
      changes *
      Math.log2(authors + 1) *
      Math.exp(-0.5 * ageYears) *
      Math.log2(churnRate + 2) *
      acceleration;

    results.push({
      file: s.file,
      score: Math.round(score * 10) / 10,
      authors,
      changes,
      churnRate: Math.round(churnRate * 10) / 10,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}

/**
 * Format curse score results as plain text.
 */
function formatCurseScoreOutput(results: CurseResult[], _top: number): string {
  const lines: string[] = [];
  lines.push(`CURSE SCORE — top ${results.length} files by risk`);

  let rank = 0;
  for (const r of results) {
    rank++;
    const rankPad = rank.toString().padStart(3, ' ');
    const filePad = r.file.padEnd(35);
    const scoreStr = `score ${r.score}`.padStart(12);
    const authorsStr = `${r.authors} authors`.padStart(12);
    const changesStr = `${r.changes} changes`.padStart(12);
    const churnStr = `churn ${r.churnRate}/yr`;
    lines.push(
      `  ${rankPad}. ${filePad} ${scoreStr}   ${authorsStr}   ${changesStr}   ${churnStr}`
    );
  }

  return lines.join('\n');
}
