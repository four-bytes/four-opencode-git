// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgeLabelCreateTool } from '../src/tools/forge-label-create';
import { forgeLabelApplyTool } from '../src/tools/forge-label-apply';
import { forgeLabelRemoveTool } from '../src/tools/forge-label-remove';

const ctx = { directory: '/tmp' };

/** Keep the tool tests hermetic: never read the developer's real secrets.env. */
let previousXdg: string | undefined;
beforeAll(() => {
  previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'forge-label-xdg-'));
});
afterAll(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
});

let saved: Record<string, string | undefined> = {};
let savedKeys: string[] = [];

beforeEach(() => {
  saved = {};
  savedKeys = Object.keys(process.env).filter((key) => key.startsWith('GITLAB_'));
  for (const key of savedKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of savedKeys) {
    const value = saved[key];
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
