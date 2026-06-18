// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { parseGitLog, type Commit } from '../lib/git-utils';
import { logDebugEvent } from '../lib/debug-logger';

/**
 * Bus factor: change-count-based approach (from git log, not blame).
 *
 * For each directory:
 *   ownership_pct = (top_author_changes / total_directory_changes) × 100
 *   bus_factor = 1 if ownership_pct > 70%
 *   bus_factor = 2 if ownership_pct > 50%
 *   bus_factor = 3+ otherwise
 */

interface DirStats {
  byAuthor: Map<string, number>;
  total: number;
}

interface BusFactorResult {
  dir: string;
  busFactor: number;
  topAuthor: string;
  topAuthorPct: number;
  breakdown: Map<string, number>;
}

export const busFactorTool = tool({
  description:
    'Calculate bus factor per directory — ownership concentration analysis using commit change counts. Identifies modules that would be orphaned if key contributors left.',

  args: {
    since: tool.schema.string().describe("Only consider commits since date (e.g., '90d', '6m')"),
  },

  async execute(args, ctx) {
    const since = args.since as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('bus_factor.start', { since: since ?? 'none' });

    try {
      const commits = await parseGitLog(cwd, since);
      const results = computeBusFactorFromLog(commits);

      if (results.length === 0) {
        return 'No git history found';
      }

      logDebugEvent('bus_factor.done', { directories: results.length });
      return formatBusFactorOutput(results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('bus_factor.error', { error: msg });
      return `Error computing bus factor: ${msg}`;
    }
  },
});

/**
 * Compute bus factor from commit log (change-count-based, not blame-based).
 */
export function computeBusFactorFromLog(commits: Commit[]): BusFactorResult[] {
  const dirStats = new Map<string, DirStats>();

  // Helper: extract top-level (or first-level) directory from file path
  function getDir(filePath: string): string {
    const idx = filePath.indexOf('/');
    if (idx === -1) return '.';
    return filePath.slice(0, idx);
  }

  const MIN_COMMITS = 5;

  for (const commit of commits) {
    for (const f of commit.files) {
      const dir = getDir(f.path);
      let ds = dirStats.get(dir);
      if (!ds) {
        ds = { byAuthor: new Map(), total: 0 };
        dirStats.set(dir, ds);
      }
      ds.total++;
      ds.byAuthor.set(commit.author, (ds.byAuthor.get(commit.author) ?? 0) + 1);
    }
  }

  const results: BusFactorResult[] = [];

  for (const [dir, ds] of dirStats) {
    // Directory with < 5 commits → mark as "insufficient data" (skip)
    if (ds.total < MIN_COMMITS) continue;

    // Find top author
    let topAuthor = '';
    let topChanges = 0;
    for (const [author, changes] of ds.byAuthor) {
      if (changes > topChanges) {
        topAuthor = author;
        topChanges = changes;
      }
    }

    const topAuthorPct = Math.round((topChanges / ds.total) * 1000) / 10;

    // Bus factor: 1 if >70%, 2 if >50%, 3+ otherwise
    let busFactor: number;
    if (topAuthorPct > 70) {
      busFactor = 1;
    } else if (topAuthorPct > 50) {
      busFactor = 2;
    } else {
      busFactor = 3; // 3+
    }

    results.push({
      dir,
      busFactor,
      topAuthor,
      topAuthorPct,
      breakdown: ds.byAuthor,
    });
  }

  // Sort by bus factor (worst first), then by top author pct desc
  results.sort((a, b) => {
    if (a.busFactor !== b.busFactor) return a.busFactor - b.busFactor;
    return b.topAuthorPct - a.topAuthorPct;
  });

  return results;
}

/**
 * Format bus factor results as plain text.
 */
function formatBusFactorOutput(results: BusFactorResult[]): string {
  const lines: string[] = [];
  lines.push('BUS FACTOR — per-directory ownership');

  for (const r of results) {
    const sorted = Array.from(r.breakdown.entries()).sort((a, b) => b[1] - a[1]);
    const totalChanges = Array.from(r.breakdown.values()).reduce((s, v) => s + v, 0);

    // Build breakdown: "alice 82%, bob 18%"
    const breakdownParts = sorted.map(([author, changes]) => {
      const pct = Math.round((changes / totalChanges) * 1000) / 10;
      return `${author} ${pct}%`;
    });
    const detail = breakdownParts.join(', ');

    const bfLabel = r.busFactor >= 3 ? '3+' : String(r.busFactor);
    const dirPad = r.dir.padEnd(14);
    lines.push(`  ${dirPad} → ${bfLabel}  (${detail})`);
  }

  return lines.join('\n');
}
