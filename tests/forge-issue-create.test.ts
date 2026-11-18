// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { forgeIssueCreateTool } from '../src/tools/forge-issue-create';

const ctx = { directory: '/tmp', worktree: '/tmp', sessionID: 't', messageID: 't', agent: 't' };

describe('forge_issue_create', () => {
  it('reports GitLab issue creation as not supported yet', async () => {
    const output = await forgeIssueCreateTool.execute(
      { title: 't', backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('not supported');
  });
});
