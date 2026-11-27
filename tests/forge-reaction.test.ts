// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgeReactionAddTool } from '../src/tools/forge-reaction-add';
import { forgeReactionListTool, formatReactionList } from '../src/tools/forge-reaction-list';

const ctx = { directory: '/tmp' };

let previousXdg: string | undefined;
beforeAll(() => {
  previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'forge-reaction-xdg-'));
});
afterAll(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
});

describe('forge_reaction_add', () => {
  it('refuses GitLab with a clear not-supported message', async () => {
    const output = await forgeReactionAddTool.execute(
      { issue: 1, content: 'heart', backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('not supported');
  });

  it('rejects content outside the canonical set', async () => {
    const output = await forgeReactionAddTool.execute(
      { issue: 1, content: 'thumbsup', backend: 'gitlab', repo: 'g/p' } as any,
      ctx as any
    );
    expect(output).toContain('invalid reaction content');
  });
});

describe('forge_reaction_list', () => {
  it('refuses GitLab with a clear not-supported message', async () => {
    const output = await forgeReactionListTool.execute({ issue: 1, backend: 'gitlab', repo: 'g/p' }, ctx as any);
    expect(output).toContain('not supported');
  });
});

describe('formatReactionList', () => {
  it('counts occurrences per content', () => {
    const output = formatReactionList(
      [{ content: '+1' }, { content: '+1' }, { content: 'heart' }],
      7,
      'github'
    );
    expect(output).toContain('+1 ×2');
    expect(output).toContain('heart ×1');
    expect(output).toContain('(total 3)');
  });

  it('reports an empty list', () => {
    expect(formatReactionList([], 7, 'forgejo')).toContain('none');
  });
});
