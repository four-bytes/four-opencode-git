// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { preMergeRefusal } from '../src/tools/gh-pr-merge';

const OPEN_PR = {
  number: 20,
  title: 'feat: thing (#17)',
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  baseRefName: 'main',
  headRefName: 'feat/17-thing',
  author: { login: 'author' },
};

// ────────────────────────────────────────────────────────────────
// preMergeRefusal (pure)
// ────────────────────────────────────────────────────────────────

describe('preMergeRefusal', () => {
  it('allows a clean, open, mergeable PR', () => {
    expect(preMergeRefusal(OPEN_PR)).toBeNull();
  });

  it('refuses an already merged PR', () => {
    expect(preMergeRefusal({ ...OPEN_PR, state: 'MERGED' })).toBe(
      'PR #20 is already merged. Nothing to do.'
    );
  });

  it('refuses a closed PR', () => {
    expect(preMergeRefusal({ ...OPEN_PR, state: 'CLOSED' })).toBe(
      '✗ PR #20 is CLOSED — not merged.'
    );
  });

  it('refuses a conflicting PR', () => {
    const refusal = preMergeRefusal({ ...OPEN_PR, mergeable: 'CONFLICTING' });
    expect(refusal).toContain('has merge conflicts');
    expect(refusal).toContain('rebase on main');
  });

  it('refuses a PR blocked by branch protection', () => {
    const refusal = preMergeRefusal({ ...OPEN_PR, mergeStateStatus: 'BLOCKED' });
    expect(refusal).toContain('blocked by branch protection');
  });
});
