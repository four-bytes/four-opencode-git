// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGit, parseGitLog } from '../lib/git-utils';
import { computeCurseScores } from './curse-score';
import { computeCoupling } from './implicit-coupling';
import { logDebugEvent } from '../lib/debug-logger';

interface FileRisk {
  file: string;
  curseScore: number;
  isTopDangerous: boolean;
  isNew: boolean;
  isTest: boolean;
}

interface CouplingRisk {
  fileA: string;
  fileB: string;
  coCommitRate: number;
}

export const prRiskTool = tool({
  description:
    'Scores the risk of uncommitted changes (staged and unstaged). Analyzes curse scores, implicit coupling, and bus factor to surface hidden dangers in your current diff.',

  args: {},

  async execute(_args, ctx) {
    const cwd = ctx.directory;

    logDebugEvent('pr_risk.start', {});

    try {
      // 1. Get changed files (staged + unstaged)
      const unstagedRaw = await runGit(['diff', '--name-only'], cwd);
      const stagedRaw = await runGit(['diff', '--cached', '--name-only'], cwd);

      const unstagedFiles = unstagedRaw
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f !== '');
      const stagedFiles = stagedRaw
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f !== '');

      const allChanged = Array.from(new Set([...unstagedFiles, ...stagedFiles])).sort();

      if (allChanged.length === 0) {
        return 'PR RISK — no changes to analyze';
      }

      // 2. Get curse scores for the repo (using recent history for relevance)
      const commits = await parseGitLog(cwd, '90 days ago');
      const curseScores = computeCurseScores(commits, 100);

      // Build a map of file → curse score
      const curseMap = new Map<string, { score: number; rank: number }>();
      curseScores.forEach((r, i) => {
        curseMap.set(r.file, { score: r.score, rank: i + 1 });
      });

      // 3. Compute implicit coupling between changed files
      let couplingRisks: CouplingRisk[] = [];
      if (allChanged.length >= 2) {
        const allCoupling = computeCoupling(commits, 0);
        couplingRisks = findCouplingBetween(allChanged, allCoupling);
      }

      // 4. Build file risk assessments
      const fileRisks: FileRisk[] = [];
      for (const file of allChanged) {
        const curseInfo = curseMap.get(file);
        fileRisks.push({
          file,
          curseScore: curseInfo?.score ?? 0,
          isTopDangerous: curseInfo ? curseInfo.rank <= 3 : false,
          isNew: !curseMap.has(file),
          isTest: isTestFile(file),
        });
      }

      // 5. Compute risk level
      const totalCurse = fileRisks.reduce((sum, f) => sum + f.curseScore, 0);
      const hasCouplingRisk = couplingRisks.some((c) => c.coCommitRate > 0.7);
      const hasHighCoupling = couplingRisks.some((c) => c.coCommitRate > 0.8);

      let riskLevel: string;
      if (totalCurse > 5000 && hasHighCoupling) {
        riskLevel = 'CRITICAL';
      } else if (totalCurse > 2000 && hasCouplingRisk) {
        riskLevel = 'HIGH';
      } else if (totalCurse > 500 || hasCouplingRisk) {
        riskLevel = 'MEDIUM';
      } else {
        riskLevel = 'LOW';
      }

      // 6. Check bus factor concern (author ownership from git log)
      const authorChanges = new Map<string, number>();
      let totalChanges = 0;
      for (const commit of commits) {
        for (const f of commit.files) {
          if (allChanged.includes(f.path)) {
            authorChanges.set(commit.author, (authorChanges.get(commit.author) ?? 0) + 1);
            totalChanges++;
          }
        }
      }

      let busFactorWarning = false;
      let topAuthor = '';
      if (totalChanges > 0) {
        for (const [author, changes] of authorChanges) {
          const pct = changes / totalChanges;
          if (pct > 0.7) {
            busFactorWarning = true;
            topAuthor = author;
            break;
          }
        }
      }

      const testOnly = fileRisks.length > 0 && fileRisks.every((f) => f.isTest);

      logDebugEvent('pr_risk.done', {
        files: allChanged.length,
        riskLevel,
        totalCurse,
        couplingPairs: couplingRisks.length,
      });

      return formatPrRiskOutput(
        fileRisks,
        couplingRisks,
        riskLevel,
        busFactorWarning,
        topAuthor,
        testOnly
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('pr_risk.error', { error: msg });
      return `Error computing PR risk: ${msg}`;
    }
  },
});

/**
 * Find coupling pairs between the changed files.
 */
function findCouplingBetween(
  changedFiles: string[],
  allCoupling: { files: [string, string]; couplingStrength: number }[]
): CouplingRisk[] {
  const changedSet = new Set(changedFiles);
  const result: CouplingRisk[] = [];

  for (const c of allCoupling) {
    if (changedSet.has(c.files[0]) && changedSet.has(c.files[1])) {
      result.push({
        fileA: c.files[0],
        fileB: c.files[1],
        coCommitRate: c.couplingStrength,
      });
    }
  }

  return result;
}

/**
 * Check if a file is a test file.
 */
function isTestFile(file: string): boolean {
  return /(^|\/)tests?\//.test(file) || /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file);
}

/**
 * Format PR risk output as plain text.
 */
export function formatPrRiskOutput(
  fileRisks: FileRisk[],
  couplingRisks: CouplingRisk[],
  riskLevel: string,
  busFactorWarning: boolean,
  topAuthor: string,
  testOnly: boolean
): string {
  const lines: string[] = [];

  lines.push(`PR RISK — ${fileRisks.length} file${fileRisks.length !== 1 ? 's' : ''} changed`);
  lines.push(`  Risk level: ${riskLevel}`);

  if (testOnly) {
    lines.push('  ℹ test-only changes, lower risk');
  }

  // File breakdown
  lines.push('');
  lines.push('  Files:');
  for (const f of fileRisks) {
    const danger = f.isTopDangerous ? '  ⚠ top 3 most dangerous file' : '';
    const newFlag = f.isNew ? '  [new file, no history to score]' : '';
    lines.push(
      `  ${f.file.padEnd(30)} curse: ${String(f.curseScore).padStart(5)}${danger}${newFlag}`
    );
  }

  // Coupling
  if (couplingRisks.length > 0) {
    lines.push('');
    lines.push('  Coupling:');
    for (const c of couplingRisks) {
      const pct = Math.round(c.coCommitRate * 100);
      lines.push(`  ⚠ ${c.fileA} ↔ ${c.fileB} co-commit rate: ${c.coCommitRate.toFixed(2)}`);
      lines.push(
        `  → These files change together ${pct}% of the time. Consider reviewing both carefully.`
      );
    }
  }

  // Bus factor
  if (busFactorWarning) {
    lines.push('');
    lines.push(`  ⚠ Low bus factor: ${topAuthor} owns >70% of these files`);
  }

  return lines.join('\n');
}
