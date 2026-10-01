// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect, afterEach } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectForgejoHosts,
  forgejoApi,
  getForgejoConfig,
  remoteHostname,
  resolveForgejoConfig,
} from '../src/lib/forgejo-utils';
import { globalSecretsPath, isGroupOrWorldReadable, parseEnvFile } from '../src/lib/secrets';

const WORK_REMOTE = 'https://forgejo.example.com/acme/widgets.git';
const CODEBERG = 'git@codeberg.org:me/proj.git';
const GITHUB = 'https://github.com/four-bytes/four-opencode-git.git';

const TWO_HOSTS = {
  FORGEJO_HOST_WORK: 'forgejo.example.com',
  FORGEJO_TOKEN_WORK: 'tok-work',
  FORGEJO_HOST_CODEBERG: 'https://codeberg.org/',
  FORGEJO_TOKEN_CODEBERG: 'tok-codeberg',
};

/** A throwaway XDG config dir with `secrets.env` holding `content`. */
function secretsDir(content: string, mode = 0o600): string {
  const xdg = mkdtempSync(join(tmpdir(), 'git-secrets-'));
  mkdirSync(join(xdg, 'four-git'));
  const path = join(xdg, 'four-git', 'secrets.env');
  writeFileSync(path, content);
  chmodSync(path, mode);
  return xdg;
}

/** A throwaway git repo whose origin is `url`. */
function repoWithOrigin(url: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-origin-'));
  Bun.spawnSync(['git', 'init', '-q'], { cwd: dir });
  Bun.spawnSync(['git', 'remote', 'add', 'origin', url], { cwd: dir });
  return dir;
}

describe('remoteHostname', () => {
  it('gives https and ssh remotes of one host the same hostname', () => {
    expect(remoteHostname('https://forgejo.example.com/acme/x.git')).toBe('forgejo.example.com');
    expect(remoteHostname('git@forgejo.example.com:acme/x.git')).toBe('forgejo.example.com');
    expect(remoteHostname('ssh://git@Forgejo.example.com:2222/acme/x.git')).toBe('forgejo.example.com');
  });

  it('ignores credentials and ports in an https remote', () => {
    expect(remoteHostname('https://user:secret@git.example.com:3000/o/r.git')).toBe(
      'git.example.com'
    );
  });

  it('returns null without a host', () => {
    expect(remoteHostname(null)).toBeNull();
    expect(remoteHostname('not-a-url')).toBeNull();
  });
});

describe('resolveForgejoConfig', () => {
  it('gives each host its own token', () => {
    expect(resolveForgejoConfig(WORK_REMOTE, TWO_HOSTS)).toEqual({
      ok: true,
      config: { token: 'tok-work', host: 'https://forgejo.example.com' },
    });
    expect(resolveForgejoConfig(CODEBERG, TWO_HOSTS)).toEqual({
      ok: true,
      config: { token: 'tok-codeberg', host: 'https://codeberg.org' },
    });
  });

  it('never pairs a token with a host it was not configured for', () => {
    const result = resolveForgejoConfig(GITHUB, TWO_HOSTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('No Forgejo token for github.com');
  });

  it('ignores a bare FORGEJO_TOKEN without FORGEJO_HOST', () => {
    const result = resolveForgejoConfig(WORK_REMOTE, { FORGEJO_TOKEN: 'tok' });
    expect(result.ok).toBe(false);
    expect(collectForgejoHosts({ FORGEJO_TOKEN: 'tok' }).warnings).toEqual([
      'FORGEJO_TOKEN has no FORGEJO_HOST — the token is never sent',
    ]);
  });

  it('still accepts the unlabelled FORGEJO_HOST + FORGEJO_TOKEN pair', () => {
    expect(
      resolveForgejoConfig(WORK_REMOTE, { FORGEJO_HOST: 'https://forgejo.example.com', FORGEJO_TOKEN: 't' })
    ).toEqual({ ok: true, config: { token: 't', host: 'https://forgejo.example.com' } });
  });

  it('takes port and subpath for the API base from the configured value only', () => {
    const vars = { FORGEJO_HOST_EX: 'https://git.example.com:3000/forgejo/', FORGEJO_TOKEN_EX: 't' };
    expect(resolveForgejoConfig('git@git.example.com:o/r.git', vars)).toEqual({
      ok: true,
      config: { token: 't', host: 'https://git.example.com:3000/forgejo' },
    });
  });

  it('refuses a host configured twice', () => {
    const result = resolveForgejoConfig(WORK_REMOTE, {
      FORGEJO_HOST_A: 'forgejo.example.com',
      FORGEJO_TOKEN_A: 'a',
      FORGEJO_HOST_B: 'https://forgejo.example.com',
      FORGEJO_TOKEN_B: 'b',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('FORGEJO_HOST_A, FORGEJO_HOST_B');
  });

  it('names the missing token variable for a host without one', () => {
    const result = resolveForgejoConfig(WORK_REMOTE, { FORGEJO_HOST_WORK: 'forgejo.example.com' });
    expect(result).toEqual({
      ok: false,
      message: 'No Forgejo token for forgejo.example.com (set FORGEJO_TOKEN_WORK)',
    });
  });

  it('warns about an unparseable host value', () => {
    expect(collectForgejoHosts({ FORGEJO_HOST_X: 'ftp://nope' }).warnings).toEqual([
      'FORGEJO_HOST_X is not a valid host — ignored',
    ]);
  });
});

describe('getForgejoConfig — secrets.env', () => {
  const fetchCalls: string[] = [];
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    fetchCalls.length = 0;
  });

  it('reads tokens from secrets.env and keeps them out of process.env', () => {
    const xdg = secretsDir('FORGEJO_HOST_WORK=forgejo.example.com\nFORGEJO_TOKEN_WORK="from-file"\n');
    const result = getForgejoConfig(repoWithOrigin(WORK_REMOTE), { XDG_CONFIG_HOME: xdg });
    expect(result).toEqual({
      ok: true,
      config: { token: 'from-file', host: 'https://forgejo.example.com' },
    });
    expect(Object.values(process.env)).not.toContain('from-file');
    expect(process.env.FORGEJO_TOKEN_WORK).toBeUndefined();
  });

  it('lets an exported variable override the file per key', () => {
    const xdg = secretsDir('FORGEJO_HOST_WORK=forgejo.example.com\nFORGEJO_TOKEN_WORK=from-file\n');
    const result = getForgejoConfig(repoWithOrigin(WORK_REMOTE), {
      XDG_CONFIG_HOME: xdg,
      FORGEJO_TOKEN_WORK: 'from-env',
    });
    expect(result.ok && result.config.token).toBe('from-env');
  });

  it('makes no request for a GitHub repo even with a Forgejo token configured', async () => {
    globalThis.fetch = (async (url: string) => {
      fetchCalls.push(String(url));
      return new Response('[]');
    }) as unknown as typeof fetch;

    const xdg = secretsDir('FORGEJO_HOST_WORK=forgejo.example.com\nFORGEJO_TOKEN_WORK=tok\n');
    const cfg = getForgejoConfig(repoWithOrigin(GITHUB), { XDG_CONFIG_HOME: xdg });
    expect(cfg.ok).toBe(false);
    if (cfg.ok) await forgejoApi('/repos/x/y/issues', cfg.config);
    expect(fetchCalls).toEqual([]);
  });

  it('is not configured without a cwd', () => {
    expect(getForgejoConfig(undefined, { FORGEJO_HOST: 'forgejo.example.com', FORGEJO_TOKEN: 't' }).ok).toBe(
      false
    );
  });
});

describe('secrets file helpers', () => {
  it('resolves the path under XDG_CONFIG_HOME, else HOME/.config', () => {
    expect(globalSecretsPath({ XDG_CONFIG_HOME: '/xdg' })).toBe('/xdg/four-git/secrets.env');
    expect(globalSecretsPath({ HOME: '/home/u' })).toBe('/home/u/.config/four-git/secrets.env');
  });

  it('parses export, quotes and comments; keeps # inside values', () => {
    expect(
      parseEnvFile("# c\nexport A=1\nB='two'\nC=\"x#y\"\nD=a # b\nbad line\n1X=no\n")
    ).toEqual({ A: '1', B: 'two', C: 'x#y', D: 'a # b' });
  });

  it('detects a group/world-readable file', () => {
    const open = join(secretsDir('A=1', 0o644), 'four-git', 'secrets.env');
    const closed = join(secretsDir('A=1', 0o600), 'four-git', 'secrets.env');
    expect(isGroupOrWorldReadable(open)).toBe(true);
    expect(isGroupOrWorldReadable(closed)).toBe(false);
    expect(isGroupOrWorldReadable('/no/such/file')).toBeNull();
  });
});

describe('forgejoApi — redirects', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('does not follow a redirect and reports it', async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seen = init;
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
    }) as unknown as typeof fetch;

    const result = await forgejoApi('/repos/o/r', { token: 't', host: 'https://forgejo.example.com' });
    expect(seen?.redirect).toBe('manual');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('redirect to https://evil.example/ not followed');
  });
});
