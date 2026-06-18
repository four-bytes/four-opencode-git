// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { parseGitLog } from '../lib/git-utils';
import { computeCurseScores } from './curse-score';
import { logDebugEvent } from '../lib/debug-logger';

interface TrendResult {
  file: string;
  recentScore: number;
  olderScore: number;
  delta: number;
  note?: string;
}

export const trendTool = tool({
  description:
    'Identifies files whose curse score is increasing over time — getting more dangerous, not stabilizing. Compares two time windows and returns files with positive trend.',

  args: {
    top: tool.schema.number().describe('Number of files to return (default: 10)'),
    window_days: tool.schema
      .number()
      .describe('Size of each comparison window in days (default: 90)'),
  },

  async execute(args, ctx) {
    const top = (args.top as number) ?? 10;
    const windowDays = (args.window_days as number) ?? 90;
    const cwd = ctx.directory;

    logDebugEvent('trend.start', { top, window_days: windowDays });

    try {
      // Recent window: last N days
      const recentCommits = await parseGitLog(cwd, `${windowDays} days ago`);

      // Older window: N to 2N days ago
      const olderCommits = await parseGitLog(
        cwd,
        `${windowDays * 2} days ago`,
        `${windowDays} days ago`
      );

      const results = computeTrend(recentCommits, olderCommits, windowDays, top);
      logDebugEvent('trend.done', {
        worsening: results.worsening.length,
        improving: results.improving.length,
      });
      return formatTrendOutput(results, windowDays, top);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('trend.error', { error: msg });
      return `Error computing curse score trends: ${msg}`;
    }
  },
});

/**
 * Compute trend by comparing curse scores between two time windows.
 */
export function computeTrend(
  recentCommits: import('../lib/git-utils').Commit[],
  olderCommits: import('../lib/git-utils').Commit[],
  windowDays: number,
  top: number
): { worsening: TrendResult[]; improving: TrendResult[]; insufficientHistory: boolean } {
  // Check for insufficient history
  if (olderCommits.length === 0) {
    // If we have recent but no older, note insufficient history
    if (recentCommits.length > 0) {
      return { worsening: [], improving: [], insufficientHistory: true };
    }
    return { worsening: [], improving: [], insufficientHistory: false };
  }

  // Compute curse scores for each window — get ALL files, not just top N
  // Use the end of each window as the reference date for curse score calculation
  const recentRefDate = new Date(); // now
  const olderRefDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000); // end of older window

  const recentScores = computeCurseScoresAll(recentCommits, recentRefDate);
  const olderScores = computeCurseScoresAll(olderCommits, olderRefDate);

  // Build map for easy lookup
  const olderMap = new Map<string, number>();
  for (const r of olderScores) {
    olderMap.set(r.file, r.score);
  }

  // Track all files we've seen
  const seenFiles = new Set<string>();
  const results: TrendResult[] = [];

  for (const r of recentScores) {
    seenFiles.add(r.file);
    const olderScore = olderMap.get(r.file) ?? 0;
    const delta = Math.round((r.score - olderScore) * 10) / 10;

    let note: string | undefined;
    if (!olderMap.has(r.file)) {
      note = 'new file, no older score';
    }

    results.push({
      file: r.file,
      recentScore: r.score,
      olderScore,
      delta,
      note,
    });
  }

  // Check for files that existed in the older window but NOT in recent (deleted)
  for (const [file, olderScore] of olderMap) {
    if (!seenFiles.has(file)) {
      results.push({
        file,
        recentScore: 0,
        olderScore,
        delta: -olderScore,
        note: 'deleted',
      });
    }
  }

  // Sort by delta descending (worsening first)
  results.sort((a, b) => b.delta - a.delta);

  const worsening = results.filter((r) => r.delta > 0).slice(0, top);
  const improving = results
    .filter((r) => r.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, top);

  return { worsening, improving, insufficientHistory: false };
}

/**
 * Compute curse scores for ALL files (not just top N).
 * Reuses the same algorithm from curse-score.ts but returns all results.
 */
function computeCurseScoresAll(
  commits: import('../lib/git-utils').Commit[],
  referenceDate?: Date
): { file: string; score: number }[] {
  // computeCurseScores with a very large topN returns all sorted results
  return computeCurseScores(commits, 10000, referenceDate).map((r) => ({
    file: r.file,
    score: r.score,
  }));
}

/**
 * Format trend output as plain text.
 */
export function formatTrendOutput(
  result: { worsening: TrendResult[]; improving: TrendResult[]; insufficientHistory: boolean },
  windowDays: number,
  _top: number
): string {
  const lines: string[] = [];

  if (result.insufficientHistory) {
    lines.push(`TREND — insufficient history for trend (need >${windowDays * 2}d of git history)`);
    lines.push('');
    lines.push('Consider using `curse_score` for a single-window analysis instead.');
    return lines.join('\n');
  }

  if (result.worsening.length === 0 && result.improving.length === 0) {
    lines.push('TREND — no significant changes detected');
    return lines.join('\n');
  }

  lines.push(`TREND — files getting more dangerous (${windowDays}d windows)`);

  for (let i = 0; i < result.worsening.length; i++) {
    const r = result.worsening[i]!;
    const rank = (i + 1).toString().padStart(3, ' ');
    const note = r.note ? `  [${r.note}]` : '';
    const recentStr = String(Math.round(r.recentScore));
    const olderStr = String(Math.round(r.olderScore));
    const deltaStr = r.delta >= 0 ? `+${Math.round(r.delta)}` : `${Math.round(r.delta)}`;
    const filePad = r.file.padEnd(35);
    lines.push(
      `  ${rank}. ${filePad} recent: ${recentStr.padStart(5)}  older: ${olderStr.padStart(5)}   Δ ${deltaStr}${note}`
    );
  }

  if (result.improving.length > 0) {
    lines.push('');
    lines.push('  Improving:');
    for (let i = 0; i < result.improving.length; i++) {
      const r = result.improving[i]!;
      const rank = (result.worsening.length + i + 1).toString() + '.';
      const rankPad = rank.padEnd(4);
      const note = r.note ? `  [${r.note}]` : '';
      const recentStr = String(Math.round(r.recentScore));
      const olderStr = String(Math.round(r.olderScore));
      const deltaStr = `${Math.round(r.delta)}`;
      const filePad = r.file.padEnd(35);
      lines.push(
        `  ${rankPad} ${filePad} recent: ${recentStr.padStart(5)}  older: ${olderStr.padStart(5)}   Δ ${deltaStr}${note}`
      );
    }
  }

  return lines.join('\n');
}
