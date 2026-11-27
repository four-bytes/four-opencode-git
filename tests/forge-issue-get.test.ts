// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { afterAll, beforeAll, describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgeIssueGetTool } from '../src/tools/forge-issue-get';

const ctx = { directory: '/tmp', worktree: '/tmp', sessionID: 't', messageID: 't', agent: 't' };

let previousXdg: string | undefined;
beforeAll(() => {
  previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'forge-issue-get-xdg-'));
});
afterAll(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
});

describe('forge_issue_get', () => {
  it('reports GitLab issue view as not supported yet', async () => {
    const output = await forgeIssueGetTool.execute(
      { issue: 1, backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('not supported');
  });
});
