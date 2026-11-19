// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { forgeLabelCreateTool } from '../src/tools/forge-label-create';
import { forgeLabelApplyTool } from '../src/tools/forge-label-apply';
import { forgeLabelRemoveTool } from '../src/tools/forge-label-remove';

const ctx = { directory: '/tmp' };

const GITLAB_KEYS = ['GITLAB_TOKEN', 'GITLAB_HOST'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of GITLAB_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('forge_label_create', () => {
  it('rejects a color that is not six hex digits', async () => {
    const output = await forgeLabelCreateTool.execute(
      { name: 'bug', color: 'red', backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('color');
    expect(output).toContain('Invalid');
  });
});

describe('forge_label_apply', () => {
  it('returns a string and does not throw for an unknown label', async () => {
    const output = await forgeLabelApplyTool.execute(
      { issue: 1, labels: 'nope', backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });
});

describe('forge_label_remove', () => {
  it('returns a string and does not throw', async () => {
    const output = await forgeLabelRemoveTool.execute(
      { issue: 1, labels: 'x', backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });
});
