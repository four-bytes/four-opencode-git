// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { forgePrCreateTool } from '../src/tools/forge-pr-create';
import { forgePrStatusTool } from '../src/tools/forge-pr-status';

const ctx = { directory: '/tmp', worktree: '/tmp', sessionID: 't', messageID: 't', agent: 't' };

/** Keep the GitLab tests hermetic: no real token, no network. */
function withoutGitLabToken<T>(fn: () => Promise<T>): Promise<T> {
  const token = process.env.GITLAB_TOKEN;
  const host = process.env.GITLAB_HOST;
  delete process.env.GITLAB_TOKEN;
  delete process.env.GITLAB_HOST;
  return fn().finally(() => {
    if (token !== undefined) process.env.GITLAB_TOKEN = token;
    if (host !== undefined) process.env.GITLAB_HOST = host;
  });
}

describe('forge_pr_create', () => {
  it('requires head for a GitLab MR', async () => {
    const output = await withoutGitLabToken(() =>
      forgePrCreateTool.execute({ title: 't', backend: 'gitlab', repo: 'g/p' }, ctx as any)
    );
    expect(output).toContain('required');
  });
});

describe('forge_pr_status', () => {
  it('resolves a GitLab status without throwing', async () => {
    const output = await withoutGitLabToken(() =>
      forgePrStatusTool.execute({ pr: 1, backend: 'gitlab', repo: 'g/p' }, ctx as any)
    );
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });
});
