// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import {
  parseCodeRabbit,
  parseCubicDev,
  parseDependabot,
  parseBotContent,
  type BotFinding,
} from '../src/tools/gh-bot-review';

// ────────────────────────────────────────────────────────────────
// Unit tests — parseCodeRabbit
// ────────────────────────────────────────────────────────────────

describe('parseCodeRabbit', () => {
  it('parses single inline finding', () => {
    const body = [
      'In `@src/tools/foo.ts`:',
      '- Line 35: Unused variable `x`. Consider removing it.',
    ].join('\n');

    const findings = parseCodeRabbit(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.bot).toBe('coderabbitai');
    expect(findings[0]!.file).toBe('src/tools/foo.ts');
    expect(findings[0]!.line).toBe(35);
    expect(findings[0]!.description).toBe('Unused variable `x`. Consider removing it.');
    expect(findings[0]!.type).toBe('nitpick');
    expect(findings[0]!.severity).toBe('nitpick');
    expect(findings[0]!.actionable).toBe(false);
  });

  it('parses multiple inline findings across files', () => {
    const body = [
      'In `@src/tools/foo.ts`:',
      '- Line 35: Unused variable `x`. Consider removing it.',
      '- Line 42: Missing return type on function `bar`.',
      '',
      'In `@src/tools/baz.ts`:',
      '- Line 10: Hardcoded string literal. Consider using a constant.',
      '',
      'Summary: 3 issues found.',
    ].join('\n');

    const findings = parseCodeRabbit(body);
    expect(findings).toHaveLength(3);
    expect(findings[0]!.file).toBe('src/tools/foo.ts');
    expect(findings[0]!.line).toBe(35);
    expect(findings[1]!.file).toBe('src/tools/foo.ts');
    expect(findings[1]!.line).toBe(42);
    expect(findings[2]!.file).toBe('src/tools/baz.ts');
    expect(findings[2]!.line).toBe(10);
  });

  it('classifies peer_dependency type correctly', () => {
    const body = [
      'In `@package.json`:',
      '- Line 1: Potential peer dependency issue. The version mismatch could cause runtime errors.',
    ].join('\n');

    const findings = parseCodeRabbit(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('peer_dependency');
    expect(findings[0]!.severity).toBe('P1');
    expect(findings[0]!.actionable).toBe(true);
  });

  it('classifies security type correctly', () => {
    const body = [
      'In `@src/config.ts`:',
      '- Line 88: This is a security concern: known vulnerabilities in imported package.',
    ].join('\n');

    const findings = parseCodeRabbit(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('security');
    expect(findings[0]!.severity).toBe('P2');
    expect(findings[0]!.actionable).toBe(true);
  });

  it('classifies supply chain security correctly', () => {
    const body = [
      'In `@src/tools/foo.ts`:',
      '- Line 15: Supply chain attack vector — pin this action to a full commit hash.',
    ].join('\n');

    const findings = parseCodeRabbit(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('security');
    expect(findings[0]!.severity).toBe('P2');
  });

  it('handles empty body', () => {
    const findings = parseCodeRabbit('');
    expect(findings).toHaveLength(0);
  });

  it('handles AI agent prompt body (meta fallback)', () => {
    const body = 'Prompt for AI: review all files for security issues.';
    const findings = parseCodeRabbit(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('meta');
    expect(findings[0]!.severity).toBe('info');
    expect(findings[0]!.actionable).toBe(false);
  });

  it('handles "finishing touches" meta body', () => {
    const body = 'The review is in progress — finishing touches.';
    const findings = parseCodeRabbit(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('meta');
    expect(findings[0]!.severity).toBe('info');
    expect(findings[0]!.actionable).toBe(false);
  });

  it('handles line with dependency keyword', () => {
    const body = [
      'In `@package.json`:',
      '- Line 5: peer dependency `lodash` is outdated. Consider updating.',
    ].join('\n');

    const findings = parseCodeRabbit(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('peer_dependency');
    expect(findings[0]!.severity).toBe('P1');
  });

  it('suggestion extraction includes description when no update pattern found', () => {
    const body = [
      'In `@src/tools/foo.ts`:',
      '- Line 35: Unused variable `x`. Consider removing it.',
    ].join('\n');

    const findings = parseCodeRabbit(body);
    expect(findings).toHaveLength(1);
    // When no "Update the..." pattern exists, suggestion falls back to description
    expect(findings[0]!.suggestion).toBeTruthy();
  });

  it('handles malformed content without crashing', () => {
    const body = 'Some random text with no inline findings whatsoever.';
    const findings = parseCodeRabbit(body);
    expect(findings).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — parseCubicDev
// ────────────────────────────────────────────────────────────────

describe('parseCubicDev', () => {
  it('parses single XML violation', () => {
    const body = [
      '<file name="src/tools/append-file.ts">',
      '<violation number="1" location="src/tools/append-file.ts:48">',
      'P1: after_line: -1 is placed at the wrong position. The prepend block should come after imports.',
      '</violation>',
      '</file>',
    ].join('\n');

    const findings = parseCubicDev(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.bot).toBe('cubic-dev-ai');
    expect(findings[0]!.file).toBe('src/tools/append-file.ts');
    expect(findings[0]!.line).toBe(48);
    expect(findings[0]!.severity).toBe('P1');
    expect(findings[0]!.type).toBe('bug');
    expect(findings[0]!.actionable).toBe(true);
    expect(findings[0]!.description).toBe(
      'after_line: -1 is placed at the wrong position. The prepend block should come after imports.'
    );
  });

  it('parses multiple violations in same file', () => {
    const body = [
      '<file name="src/tools/foo.ts">',
      '<violation number="1" location="src/tools/foo.ts:10">',
      'P1: Function `bar` is missing type annotations.',
      '</violation>',
      '<violation number="2" location="src/tools/foo.ts:25">',
      'P2: Variable name `x` could be more descriptive.',
      '</violation>',
      '</file>',
    ].join('\n');

    const findings = parseCubicDev(body);
    expect(findings).toHaveLength(2);
    expect(findings[0]!.line).toBe(10);
    expect(findings[0]!.severity).toBe('P1');
    expect(findings[1]!.line).toBe(25);
    expect(findings[1]!.severity).toBe('P2');
  });

  it('parses violations across multiple files', () => {
    const body = [
      '<file name="src/a.ts">',
      '<violation number="1" location="src/a.ts:5">',
      'P1: Missing error handling.',
      '</violation>',
      '</file>',
      '<file name="src/b.ts">',
      '<violation number="1" location="src/b.ts:12">',
      'P2: Unused import.',
      '</violation>',
      '</file>',
    ].join('\n');

    const findings = parseCubicDev(body);
    expect(findings).toHaveLength(2);
    expect(findings[0]!.file).toBe('src/a.ts');
    expect(findings[1]!.file).toBe('src/b.ts');
  });

  it('handles violation without explicit severity prefix', () => {
    const body = [
      '<file name="src/tools/bar.ts">',
      '<violation number="1" location="src/tools/bar.ts:99">',
      'Some issue without P1/P2 prefix.',
      '</violation>',
      '</file>',
    ].join('\n');

    const findings = parseCubicDev(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('P2'); // default
    expect(findings[0]!.description).toBe('Some issue without P1/P2 prefix.');
  });

  it('handles empty body', () => {
    const findings = parseCubicDev('');
    expect(findings).toHaveLength(0);
  });

  it('handles malformed XML gracefully', () => {
    const body = 'Some random text with no XML structure.';
    const findings = parseCubicDev(body);
    expect(findings).toHaveLength(0);
  });

  it('handles file with no violations', () => {
    const body = '<file name="src/tools/bar.ts">\n</file>';
    const findings = parseCubicDev(body);
    expect(findings).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — parseDependabot
// ────────────────────────────────────────────────────────────────

describe('parseDependabot', () => {
  it('parses bump from PR body', () => {
    const body = 'Bumps @typescript-eslint/parser from 8.47.0 to 8.61.0';
    const findings = parseDependabot(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.bot).toBe('dependabot');
    expect(findings[0]!.type).toBe('dependency');
    expect(findings[0]!.severity).toBe('info');
    expect(findings[0]!.file).toBe('package.json');
    expect(findings[0]!.line).toBe(0);
    expect(findings[0]!.description).toBe(
      'Bump @typescript-eslint/parser from 8.47.0 to 8.61.0'
    );
    expect(findings[0]!.actionable).toBe(true);
  });

  it('parses bump with "Bump" (singular) variant', () => {
    const body = 'Bump eslint-plugin-prettier from 5.5.5 to 5.5.6';
    const findings = parseDependabot(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.description).toBe(
      'Bump eslint-plugin-prettier from 5.5.5 to 5.5.6'
    );
  });

  it('parses bump with scoped package name', () => {
    const body = 'Bumps @scope/package from 1.0.0 to 2.0.0';
    const findings = parseDependabot(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.description).toBe('Bump @scope/package from 1.0.0 to 2.0.0');
  });

  it('handles empty body', () => {
    const findings = parseDependabot('');
    expect(findings).toHaveLength(0);
  });

  it('handles unrelated body', () => {
    const body = 'This is just a regular comment about the PR.';
    const findings = parseDependabot(body);
    expect(findings).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────
// Unit tests — parseBotContent
// ────────────────────────────────────────────────────────────────

describe('parseBotContent', () => {
  it('routes to coderabbitai parser correctly', () => {
    const body = [
      'In `@src/tools/foo.ts`:',
      '- Line 35: Unused variable `x`.',
    ].join('\n');

    const findings = parseBotContent(body, 'coderabbitai[bot]');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.bot).toBe('coderabbitai');
  });

  it('routes to cubic-dev-ai parser correctly', () => {
    const body = [
      '<file name="src/tools/foo.ts">',
      '<violation number="1" location="src/tools/foo.ts:48">',
      'P1: Missing type annotation.',
      '</violation>',
      '</file>',
    ].join('\n');

    const findings = parseBotContent(body, 'cubic-dev-ai[bot]');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.bot).toBe('cubic-dev-ai');
  });

  it('routes to dependabot parser correctly', () => {
    const body = 'Bumps some-package from 1.0.0 to 2.0.0';
    const findings = parseBotContent(body, 'dependabot[bot]');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.bot).toBe('dependabot');
  });

  it('returns empty array for unknown bot', () => {
    const findings = parseBotContent('Some comment body', 'some-other-bot');
    expect(findings).toHaveLength(0);
  });

  it('returns empty for empty body and known bot', () => {
    const findings = parseBotContent('', 'coderabbitai[bot]');
    expect(findings).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────
// Verify BotFinding type shape
// ────────────────────────────────────────────────────────────────

describe('BotFinding type structure', () => {
  it('all findings have the correct shape', () => {
    const finding: BotFinding = {
      bot: 'coderabbitai',
      type: 'nitpick',
      severity: 'nitpick',
      file: 'src/test.ts',
      line: 42,
      description: 'test finding',
      suggestion: 'test suggestion',
      actionable: false,
    };

    expect(finding).toHaveProperty('bot');
    expect(finding).toHaveProperty('type');
    expect(finding).toHaveProperty('severity');
    expect(finding).toHaveProperty('file');
    expect(finding).toHaveProperty('line');
    expect(finding).toHaveProperty('description');
    expect(finding).toHaveProperty('suggestion');
    expect(finding).toHaveProperty('actionable');
  });
});
