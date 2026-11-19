// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { forgePrCloseTool } from '../src/tools/forge-pr-close';

const ctx = { directory: '/tmp' };

describe('forge_pr_close', () => {
  it('reports GitLab merge-request close as not supported', async () => {
    const output = await forgePrCloseTool.execute(
      { pr: 1, backend: 'gitlab', repo: 'g/p' },
      ctx as any
    );
    expect(output).toContain('not supported');
  });
});
