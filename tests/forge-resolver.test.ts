// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectBackend, resolveForgeContext } from '../src/lib/forge-resolver';

/** A throwaway directory that is not a git repository. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'forge-resolver-'));
}

// ────────────────────────────────────────────────────────────────
// detectBackend — pure provider detection
// ────────────────────────────────────────────────────────────────

describe('detectBackend', () => {
  it('detects GitHub from an https remote', () => {
    expect(detectBackend('https://github.com/x/y.git', {})).toBe('github');
  });

  it('detects GitLab from gitlab.com', () => {
    expect(detectBackend('https://gitlab.com/x/y.git', {})).toBe('gitlab');
  });

  it('returns null without a remote and without config', () => {
    expect(detectBackend(null, {})).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// resolveForgeContext — backend + repo resolved once
// ────────────────────────────────────────────────────────────────

describe('resolveForgeContext', () => {
  it('honours a GitHub backend + repo override without touching git or the network', async () => {
    const resolved = await resolveForgeContext(tempDir(), { backend: 'github', repo: 'a/b' });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.ctx.backend).toBe('github');
    expect(resolved.ctx.repo).toBe('a/b');
  });

  it('honours a GitLab backend + repo override', async () => {
    const resolved = await resolveForgeContext(tempDir(), { backend: 'gitlab', repo: 'g/p' });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.ctx.backend).toBe('gitlab');
    expect(resolved.ctx.repo).toBe('g/p');
  });

  it('reports no backend for a directory that is not a git repo', async () => {
    const saved: Record<string, string | undefined> = {};
    const keys = Object.keys(process.env).filter(
      (key) => key === 'GITLAB_TOKEN' || key === 'GITLAB_HOST' || key.startsWith('FORGEJO_HOST')
    );
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      const resolved = await resolveForgeContext(tempDir(), {});
      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.message).toContain('No issue backend');
    } finally {
      for (const key of keys) process.env[key] = saved[key];
    }
  });
});
