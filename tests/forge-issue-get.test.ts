// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { forgeIssueGetTool } from '../src/tools/forge-issue-get';

const ctx = { directory: '/tmp', worktree: '/tmp', sessionID: 't', messageID: 't', agent: 't' };

describe('forge_issue_get', () => {
  it('reports GitLab issue view as not supported yet', async () => {
    const output = await forgeIssueGetTool.execute(
      { issue: 1, backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('not supported');
  });
});
