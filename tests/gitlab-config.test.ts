// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect, afterEach } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectGitLabHosts,
  getGitLabConfig,
  gitlabApi,
  resolveGitLabConfig,
} from '../src/lib/gitlab-utils';
import { remoteHostname } from '../src/lib/forge-hosts';

const WORK_REMOTE = 'https://gitlab.example.com/acme/widgets.git';
const NETFORMIC_REMOTE = 'git@gitlab.netformic.cloud:me/proj.git';
const GITHUB = 'https://github.com/four-bytes/four-opencode-git.git';

const TWO_HOSTS = {
  GITLAB_HOST_WORK: 'gitlab.example.com',
  GITLAB_TOKEN_WORK: 'tok-work',
  GITLAB_HOST_NETFORMIC: 'https://gitlab.netformic.cloud/',
  GITLAB_TOKEN_NETFORMIC: 'tok-netformic',
};

/** A throwaway XDG config dir with `secrets.env` holding `content`. */
function secretsDir(content: string, mode = 0o600): string {
  const xdg = mkdtempSync(join(tmpdir(), 'gitlab-secrets-'));
  mkdirSync(join(xdg, 'four-git'));
  const path = join(xdg, 'four-git', 'secrets.env');
  writeFileSync(path, content);
  chmodSync(path, mode);
  return xdg;
}

/** A throwaway git repo whose origin is `url`. */
function repoWithOrigin(url: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-origin-'));
  Bun.spawnSync(['git', 'init', '-q'], { cwd: dir });
  Bun.spawnSync(['git', 'remote', 'add', 'origin', url], { cwd: dir });
  return dir;
}

describe('remoteHostname (shared with Forgejo)', () => {
  it('gives https and ssh remotes of one host the same hostname', () => {
    expect(remoteHostname('https://gitlab.example.com/acme/x.git')).toBe('gitlab.example.com');
    expect(remoteHostname('git@gitlab.example.com:acme/x.git')).toBe('gitlab.example.com');
    expect(remoteHostname('ssh://git@GitLab.example.com:2222/acme/x.git')).toBe(
      'gitlab.example.com'
    );
  });
});

describe('resolveGitLabConfig', () => {
  it('gives each host its own token', () => {
    expect(resolveGitLabConfig(WORK_REMOTE, TWO_HOSTS)).toEqual({
      ok: true,
      config: { token: 'tok-work', host: 'https://gitlab.example.com' },
    });
    expect(resolveGitLabConfig(NETFORMIC_REMOTE, TWO_HOSTS)).toEqual({
      ok: true,
      config: { token: 'tok-netformic', host: 'https://gitlab.netformic.cloud' },
    });
  });

  it('never pairs a token with a host it was not configured for', () => {
    const result = resolveGitLabConfig(GITHUB, TWO_HOSTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('No GitLab token for github.com');
  });

  it('binds a bare GITLAB_TOKEN to gitlab.com only', () => {
    expect(resolveGitLabConfig('https://gitlab.com/grp/proj.git', { GITLAB_TOKEN: 'tok' })).toEqual({
      ok: true,
      config: { token: 'tok', host: 'https://gitlab.com' },
    });

    const selfHosted = resolveGitLabConfig(WORK_REMOTE, { GITLAB_TOKEN: 'tok' });
    expect(selfHosted.ok).toBe(false);
    if (!selfHosted.ok) expect(selfHosted.message).toContain('No GitLab token for gitlab.example.com');
    // The bare token is the documented default, so it is not an orphan.
    expect(collectGitLabHosts({ GITLAB_TOKEN: 'tok' }).warnings).toEqual([]);
  });

  it('still accepts the unlabelled GITLAB_HOST + GITLAB_TOKEN pair', () => {
    expect(
      resolveGitLabConfig(WORK_REMOTE, {
        GITLAB_HOST: 'https://gitlab.example.com',
        GITLAB_TOKEN: 't',
      })
    ).toEqual({ ok: true, config: { token: 't', host: 'https://gitlab.example.com' } });
  });

  it('takes port and subpath for the API base from the configured value only', () => {
    const vars = {
      GITLAB_HOST_EX: 'https://git.example.com:3000/gitlab/',
      GITLAB_TOKEN_EX: 't',
    };
    expect(resolveGitLabConfig('git@git.example.com:o/r.git', vars)).toEqual({
      ok: true,
      config: { token: 't', host: 'https://git.example.com:3000/gitlab' },
    });
  });

  it('refuses a host configured twice', () => {
    const result = resolveGitLabConfig(WORK_REMOTE, {
      GITLAB_HOST_A: 'gitlab.example.com',
      GITLAB_TOKEN_A: 'a',
      GITLAB_HOST_B: 'https://gitlab.example.com',
      GITLAB_TOKEN_B: 'b',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('GITLAB_HOST_A, GITLAB_HOST_B');
  });

  it('names the missing token variable for a host without one', () => {
    const result = resolveGitLabConfig(WORK_REMOTE, { GITLAB_HOST_WORK: 'gitlab.example.com' });
    expect(result).toEqual({
      ok: false,
      message: 'No GitLab token for gitlab.example.com (set GITLAB_TOKEN_WORK)',
    });
  });

  it('warns about an unparseable host value and an orphaned labelled token', () => {
    expect(collectGitLabHosts({ GITLAB_HOST_X: 'ftp://nope' }).warnings).toEqual([
      'GITLAB_HOST_X is not a valid host — ignored',
    ]);
    expect(collectGitLabHosts({ GITLAB_TOKEN_X: 'tok' }).warnings).toEqual([
      'GITLAB_TOKEN_X has no GITLAB_HOST_X — the token is never sent',
    ]);
  });

  it('reports no config without a remote host', () => {
    expect(resolveGitLabConfig(null, {})).toEqual({
      ok: false,
      message: 'GitLab not configured (no origin remote with a host)',
    });
  });
});

describe('getGitLabConfig — secrets.env', () => {
  const fetchCalls: string[] = [];
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    fetchCalls.length = 0;
  });

  it('reads tokens from secrets.env and keeps them out of process.env', () => {
    const xdg = secretsDir(
      'GITLAB_HOST_NETFORMIC=gitlab.netformic.cloud\nGITLAB_TOKEN_NETFORMIC="from-file"\n'
    );
    const result = getGitLabConfig(repoWithOrigin(NETFORMIC_REMOTE), { XDG_CONFIG_HOME: xdg });
    expect(result).toEqual({
      ok: true,
      config: { token: 'from-file', host: 'https://gitlab.netformic.cloud' },
    });
    expect(Object.values(process.env)).not.toContain('from-file');
    expect(process.env.GITLAB_TOKEN_NETFORMIC).toBeUndefined();
  });

  it('lets an exported variable override the file per key', () => {
    const xdg = secretsDir(
      'GITLAB_HOST_NETFORMIC=gitlab.netformic.cloud\nGITLAB_TOKEN_NETFORMIC=from-file\n'
    );
    const result = getGitLabConfig(repoWithOrigin(NETFORMIC_REMOTE), {
      XDG_CONFIG_HOME: xdg,
      GITLAB_TOKEN_NETFORMIC: 'from-env',
    });
    expect(result.ok && result.config.token).toBe('from-env');
  });

  it('makes no request for a GitHub repo even with a GitLab token configured', async () => {
    globalThis.fetch = (async (url: string) => {
      fetchCalls.push(String(url));
      return new Response('[]');
    }) as unknown as typeof fetch;

    const xdg = secretsDir(
      'GITLAB_HOST_NETFORMIC=gitlab.netformic.cloud\nGITLAB_TOKEN_NETFORMIC=tok\n'
    );
    const cfg = getGitLabConfig(repoWithOrigin(GITHUB), { XDG_CONFIG_HOME: xdg });
    expect(cfg.ok).toBe(false);
    if (cfg.ok) await gitlabApi('projects/x/y/issues', cfg.config);
    expect(fetchCalls).toEqual([]);
  });

  it('is not configured without a cwd', () => {
    expect(
      getGitLabConfig(undefined, {
        GITLAB_HOST: 'gitlab.example.com',
        GITLAB_TOKEN: 't',
      }).ok
    ).toBe(false);
  });
});

describe('gitlabApi — redirects', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sends PRIVATE-TOKEN, does not follow a redirect and reports it', async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seen = init;
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
    }) as unknown as typeof fetch;

    const result = await gitlabApi('projects/o/r', {
      token: 't',
      host: 'https://gitlab.example.com',
    });
    expect(seen?.redirect).toBe('manual');
    expect((seen?.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('t');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('redirect to https://evil.example/ not followed');
    expect(result.error).toContain('GITLAB_HOST');
  });
});
