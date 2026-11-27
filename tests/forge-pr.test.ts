// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { afterAll, afterEach, beforeAll, describe, it, expect, mock } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgePrCreateTool } from '../src/tools/forge-pr-create';
import { forgePrStatusTool } from '../src/tools/forge-pr-status';

const ctx = { directory: '/tmp', worktree: '/tmp', sessionID: 't', messageID: 't', agent: 't' };

/** Keep the tool tests hermetic: never read the developer's real secrets.env. */
let previousXdg: string | undefined;
let previousGitUtils: Record<string, unknown>;
beforeAll(() => {
  // Other test files mock `git-utils` process-wide; these tests read a real
  // `origin` remote, so install a real `runGit` for this file and restore the
  // previous module afterwards.
  previousGitUtils = require('../src/lib/git-utils');
  mock.module('../src/lib/git-utils', () => ({
    ...previousGitUtils,
    runGit: async (args: string[], cwd: string) => {
      const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) throw new Error(stderr.trim() || `git exited with ${exitCode}`);
      return stdout.trim();
    },
  }));
  previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'forge-pr-xdg-'));
});
afterAll(() => {
  mock.module('../src/lib/git-utils', () => ({ ...previousGitUtils }));
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
});

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

const NETFORMIC_REMOTE = 'git@gitlab.netformic.cloud:me/proj.git';
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A throwaway repo with `origin` = `url`, plus a secrets.env holding `content`. */
function repoWithSecrets(url: string, content: string): { repo: string; xdg: string } {
  const repo = mkdtempSync(join(tmpdir(), 'forge-pr-repo-'));
  Bun.spawnSync(['git', 'init', '-q'], { cwd: repo });
  Bun.spawnSync(['git', 'remote', 'add', 'origin', url], { cwd: repo });
  const xdg = mkdtempSync(join(tmpdir(), 'forge-pr-secrets-'));
  mkdirSync(join(xdg, 'four-git'));
  writeFileSync(join(xdg, 'four-git', 'secrets.env'), content);
  return { repo, xdg };
}

/** Run `fn` with XDG_CONFIG_HOME pointed at `xdg`, then restore it. */
async function withXdg<T>(xdg: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
  }
}

describe('forge_pr_create', () => {
  it('requires head for a GitLab MR', async () => {
    const output = await withoutGitLabToken(() =>
      forgePrCreateTool.execute({ title: 't', backend: 'gitlab', repo: 'g/p' }, ctx as any)
    );
    expect(output).toContain('required');
  });

  it('detects a self-hosted GitLab from secrets.env and sends only that host token', async () => {
    const { repo, xdg } = repoWithSecrets(
      NETFORMIC_REMOTE,
      'GITLAB_HOST_NETFORMIC=gitlab.netformic.cloud\nGITLAB_TOKEN_NETFORMIC=file-token\n'
    );
    const calls: { url: string; headers: Record<string, string> }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return Response.json({
        iid: 7,
        title: 'MR',
        web_url: 'https://gitlab.netformic.cloud/me/proj/-/merge_requests/7',
      });
    }) as unknown as typeof fetch;

    await withXdg(xdg, async () => {
      // Neither the host nor the token is exported — the file alone drives it.
      expect(process.env.GITLAB_HOST_NETFORMIC).toBeUndefined();
      expect(process.env.GITLAB_TOKEN_NETFORMIC).toBeUndefined();

      const output = await forgePrCreateTool.execute(
        { title: 'MR', head: 'feat/x' },
        { ...ctx, directory: repo } as any
      );

      expect(output).toStartWith('[gitlab] MR !7 created');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe(
        'https://gitlab.netformic.cloud/api/v4/projects/me%2Fproj/merge_requests'
      );
      expect(calls[0]!.headers['PRIVATE-TOKEN']).toBe('file-token');
      // Reading the file must never copy the token into the environment.
      expect(process.env.GITLAB_TOKEN_NETFORMIC).toBeUndefined();
    });
  });

  it('returns the actionable missing-token line, not "No issue backend"', async () => {
    const { repo, xdg } = repoWithSecrets(
      NETFORMIC_REMOTE,
      'GITLAB_HOST_NETFORMIC=gitlab.netformic.cloud\nGITLAB_TOKEN_NETFORMIC=\n'
    );
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return Response.json({});
    }) as unknown as typeof fetch;

    await withXdg(xdg, async () => {
      const output = await forgePrCreateTool.execute(
        { title: 'MR', head: 'feat/x' },
        { ...ctx, directory: repo } as any
      );

      expect(output).toContain(
        'No GitLab token for gitlab.netformic.cloud (set GITLAB_TOKEN_NETFORMIC)'
      );
      expect(output).not.toContain('No issue backend');
      expect(calls).toEqual([]);
    });
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
