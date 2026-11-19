// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { forgeIssueCloseTool } from '../src/tools/forge-issue-close';

const ctx = { directory: '/tmp', worktree: '/tmp', sessionID: 't', messageID: 't', agent: 't' };

describe('forge_issue_close', () => {
  it('reports GitLab issue close as not supported yet', async () => {
    const output = await forgeIssueCloseTool.execute(
      { issue: 1, backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('not supported');
  });
});
