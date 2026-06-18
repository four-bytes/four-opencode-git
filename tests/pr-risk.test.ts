// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { formatPrRiskOutput } from '../src/tools/pr-risk';

describe('formatPrRiskOutput', () => {
  it('formats LOW risk output', () => {
    const fileRisks = [
      { file: 'README.md', curseScore: 10, isTopDangerous: false, isNew: false, isTest: false },
    ];

    const output = formatPrRiskOutput(fileRisks, [], 'LOW', false, '', false);
    expect(output).toContain('PR RISK — 1 file changed');
    expect(output).toContain('Risk level: LOW');
    expect(output).toContain('README.md');
  });

  it('formats MEDIUM risk with coupling', () => {
    const fileRisks = [
      {
        file: 'src/handler.ts',
        curseScore: 1842,
        isTopDangerous: true,
        isNew: false,
        isTest: false,
      },
      {
        file: 'src/middleware.ts',
        curseScore: 1201,
        isTopDangerous: false,
        isNew: false,
        isTest: false,
      },
    ];

    const coupling = [{ fileA: 'src/handler.ts', fileB: 'src/middleware.ts', coCommitRate: 0.88 }];

    const output = formatPrRiskOutput(fileRisks, coupling, 'MEDIUM', false, '', false);
    expect(output).toContain('MEDIUM');
    expect(output).toContain('top 3 most dangerous file');
    expect(output).toContain('co-commit rate: 0.88');
    expect(output).toContain('These files change together');
  });

  it('marks HIGH risk when curse sum > 2000 with coupling', () => {
    const fileRisks = [
      {
        file: 'src/a.ts',
        curseScore: 1500,
        isTopDangerous: true,
        isNew: false,
        isTest: false,
      },
      {
        file: 'src/b.ts',
        curseScore: 800,
        isTopDangerous: false,
        isNew: false,
        isTest: false,
      },
    ];

    const coupling = [{ fileA: 'src/a.ts', fileB: 'src/b.ts', coCommitRate: 0.75 }];
    const output = formatPrRiskOutput(fileRisks, coupling, 'HIGH', false, '', false);
    expect(output).toContain('HIGH');
  });

  it('marks CRITICAL risk when curse sum > 5000 with high coupling', () => {
    const fileRisks = [
      {
        file: 'src/a.ts',
        curseScore: 3000,
        isTopDangerous: true,
        isNew: false,
        isTest: false,
      },
      {
        file: 'src/b.ts',
        curseScore: 2500,
        isTopDangerous: true,
        isNew: false,
        isTest: false,
      },
    ];

    const coupling = [{ fileA: 'src/a.ts', fileB: 'src/b.ts', coCommitRate: 0.9 }];
    const output = formatPrRiskOutput(fileRisks, coupling, 'CRITICAL', false, '', false);
    expect(output).toContain('CRITICAL');
  });

  it('detects low bus factor warning', () => {
    const fileRisks = [
      {
        file: 'src/core.ts',
        curseScore: 500,
        isTopDangerous: false,
        isNew: false,
        isTest: false,
      },
    ];

    const output = formatPrRiskOutput(fileRisks, [], 'MEDIUM', true, 'Alice', false);
    expect(output).toContain('Low bus factor');
    expect(output).toContain('Alice');
  });

  it('notes test-only changes', () => {
    const fileRisks = [
      {
        file: 'tests/a.test.ts',
        curseScore: 45,
        isTopDangerous: false,
        isNew: false,
        isTest: true,
      },
      {
        file: 'tests/b.test.ts',
        curseScore: 25,
        isTopDangerous: false,
        isNew: false,
        isTest: true,
      },
    ];

    const output = formatPrRiskOutput(fileRisks, [], 'LOW', false, '', true);
    expect(output).toContain('test-only changes');
  });

  it('marks new files with no history', () => {
    const fileRisks = [
      { file: 'src/new_file.ts', curseScore: 0, isTopDangerous: false, isNew: true, isTest: false },
    ];

    const output = formatPrRiskOutput(fileRisks, [], 'LOW', false, '', false);
    expect(output).toContain('new file, no history to score');
  });

  it('formats plural correctly for single file', () => {
    const fileRisks = [
      { file: 'src/solo.ts', curseScore: 100, isTopDangerous: false, isNew: false, isTest: false },
    ];

    const output = formatPrRiskOutput(fileRisks, [], 'LOW', false, '', false);
    expect(output).toContain('1 file changed');
  });
});
