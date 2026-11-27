// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { afterAll, beforeAll, describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgePrMergeTool } from '../src/tools/forge-pr-merge';
import { forgePrReviewTool } from '../src/tools/forge-pr-review';
import { forgePrCommentsTool } from '../src/tools/forge-pr-comments';

const ctx = { directory: '/tmp' };

let previousXdg: string | undefined;
beforeAll(() => {
  previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'forge-pr-merge-xdg-'));
});
afterAll(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
});

describe('forge_pr_merge', () => {
  it('rejects rebase-merge for GitHub with a clear message', async () => {
    const output = await forgePrMergeTool.execute(
      { pr: 1, method: 'rebase-merge', backend: 'github', repo: 'a/b' },
      ctx as any
    );
    expect(output).toContain('not supported by GitHub');
  });

  it('reports GitLab merge as not supported', async () => {
    const output = await forgePrMergeTool.execute(
      { pr: 1, backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('not supported');
  });
});

describe('forge_pr_review', () => {
  it('points Forgejo reviews at forge_pr_comments', async () => {
    const output = await forgePrReviewTool.execute(
      { pr: 1, backend: 'forgejo', repo: 'a/b' },
      ctx as any
    );
    expect(output).toContain('forge_pr_comments');
  });
});

describe('forge_pr_comments', () => {
  it('reports GitLab comments as not supported', async () => {
    const output = await forgePrCommentsTool.execute(
      { pr: 1, backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('not supported');
  });
});
