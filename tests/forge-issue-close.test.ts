// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { afterAll, beforeAll, describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgeIssueCloseTool } from '../src/tools/forge-issue-close';

const ctx = { directory: '/tmp', worktree: '/tmp', sessionID: 't', messageID: 't', agent: 't' };

let previousXdg: string | undefined;
beforeAll(() => {
  previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'forge-issue-close-xdg-'));
});
afterAll(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
});

describe('forge_issue_close', () => {
  it('reports GitLab issue close as not supported yet', async () => {
    const output = await forgeIssueCloseTool.execute(
      { issue: 1, backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('not supported');
  });
});
