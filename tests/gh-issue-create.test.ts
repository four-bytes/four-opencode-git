// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, expect, test } from 'bun:test';
import {
  findUnknown,
  formatGhIssueCreated,
  formatUnknownAssignees,
  formatUnknownLabels,
  splitList,
} from '../src/tools/gh-issue-create';

// ────────────────────────────────────────────────────────────────
// splitList / findUnknown
// ────────────────────────────────────────────────────────────────

describe('splitList', () => {
  test('splits, trims and drops empty entries', () => {
    expect(splitList(' bug, agent-code ,,')).toEqual(['bug', 'agent-code']);
  });

  test('returns an empty array for undefined or blank input', () => {
    expect(splitList(undefined)).toEqual([]);
    expect(splitList('   ')).toEqual([]);
  });
});

describe('findUnknown', () => {
  test('reports missing names and matches case-insensitively', () => {
    expect(findUnknown(['Bug', 'nope', 'caught-dev'], ['bug', 'caught-dev'])).toEqual(['nope']);
  });

  test('returns nothing when every requested name is known', () => {
    expect(findUnknown(['bug'], ['bug', 'feature'])).toEqual([]);
  });

  test('returns every request against an empty known list', () => {
    expect(findUnknown(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});

// ────────────────────────────────────────────────────────────────
// Refusal lines
// ────────────────────────────────────────────────────────────────

describe('formatUnknownLabels', () => {
  test('names the repo and the unknown labels', () => {
    expect(formatUnknownLabels(['hit-prod', 'nope'], 'acme/widgets')).toBe(
      '✗ Issue not created — unknown label(s) in acme/widgets: hit-prod, nope. Create them first, then retry.'
    );
  });
});

describe('formatUnknownAssignees', () => {
  test('names the repo and the unknown assignees', () => {
    expect(formatUnknownAssignees(['ghost'], 'acme/widgets')).toBe(
      '✗ Issue not created — unknown assignee(s) in acme/widgets: ghost. Create them first, then retry.'
    );
  });
});

// ────────────────────────────────────────────────────────────────
// Success formatter
// ────────────────────────────────────────────────────────────────

describe('formatGhIssueCreated', () => {
  test('prints number, title, url and compact refs', () => {
    const out = formatGhIssueCreated(
      { number: 42, title: '[FIX] thing', html_url: 'https://github.com/acme/widgets/issues/42' },
      ['bug', 'agent-code'],
      ['alice']
    );
    expect(out).toBe(
      '✓ Created #42 [FIX] thing\n' +
        '  https://github.com/acme/widgets/issues/42 [labels: bug,agent-code] [assignees: alice]'
    );
  });

  test('omits the ref block without labels and assignees', () => {
    expect(formatGhIssueCreated({ number: 7, title: 't', html_url: 'u' }, [], [])).toBe(
      '✓ Created #7 t\n  u'
    );
  });

  test('tolerates a sparse payload and trims the trailing newline', () => {
    expect(formatGhIssueCreated({ number: 1 }, [], ['bob'])).toBe(
      '✓ Created #1 [assignees: bob]'
    );
  });
});
