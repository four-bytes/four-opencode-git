// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { logDebugEvent } from './debug-logger';
import { originUrl, parseConfiguredHost, remoteHostname } from './forge-hosts';
import { warnOnce } from './plugin-log';
import { globalSecretsPath, isGroupOrWorldReadable, secretVars } from './secrets';

export interface GitLabConfig {
  token: string;
  /** API base (scheme + host[:port][/subpath]) — always taken from the configured entry. */
  host: string;
}

/**
 * Result of resolving GitLab config. `ok: false` carries a one-line message the
 * tool returns verbatim — it names host and variable, never a value.
 */
export type GitLabConfigResult =
  | { ok: true; config: GitLabConfig }
  | { ok: false; message: string };

export interface GitLabApiResult {
  ok: boolean;
  status: number;
  data: any;
  error?: string;
}

export interface GitLabApiInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: object;
}

/** One configured host: `GITLAB_HOST[_<LABEL>]` + `GITLAB_TOKEN[_<LABEL>]`. */
export interface GitLabHostEntry {
  /** `''` for the unlabelled pair (or the bare-token default), else the `<LABEL>` suffix. */
  label: string;
  /** Lowercase hostname, the only thing matched against the origin remote. */
  hostname: string;
  /** API base built from the configured value. */
  base: string;
  token?: string;
}

const HOST_KEY = /^GITLAB_HOST(?:_([A-Z0-9_]+))?$/;
const TOKEN_KEY = /^GITLAB_TOKEN(?:_([A-Z0-9_]+))?$/;

const hostVar = (label: string) => (label ? `GITLAB_HOST_${label}` : 'GITLAB_HOST');
const tokenVar = (label: string) => (label ? `GITLAB_TOKEN_${label}` : 'GITLAB_TOKEN');

/**
 * Collect configured hosts from `GITLAB_*` variables. Pure — exported for tests.
 *
 * A bare `GITLAB_TOKEN` without any `GITLAB_HOST[_<LABEL>]` is the documented
 * gitlab.com default and becomes one entry for `https://gitlab.com` only. A
 * labelled token without its host, and an unparseable host value, are returned
 * as `warnings` (variable names only).
 */
export function collectGitLabHosts(vars: Record<string, string | undefined>): {
  entries: GitLabHostEntry[];
  warnings: string[];
} {
  const entries: GitLabHostEntry[] = [];
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(vars)) {
    const m = key.match(HOST_KEY);
    if (!m || value === undefined) continue;
    const label = m[1] ?? '';
    const parsed = parseConfiguredHost(value);
    if (!parsed) {
      warnings.push(`${key} is not a valid host — ignored`);
      continue;
    }
    entries.push({ label, ...parsed, token: vars[tokenVar(label)] || undefined });
  }

  // Documented default: a bare token with no host at all belongs to gitlab.com.
  const bareToken = vars.GITLAB_TOKEN;
  if (bareToken && vars.GITLAB_HOST === undefined) {
    entries.push({
      label: '',
      hostname: 'gitlab.com',
      base: 'https://gitlab.com',
      token: bareToken,
    });
  }

  for (const [key, value] of Object.entries(vars)) {
    const m = key.match(TOKEN_KEY);
    if (!m || !value) continue;
    const label = m[1] ?? '';
    // The bare token has the gitlab.com default; only labelled tokens can be orphaned.
    if (label !== '' && vars[hostVar(label)] === undefined) {
      warnings.push(`${key} has no ${hostVar(label)} — the token is never sent`);
    }
  }

  return { entries, warnings };
}

/**
 * Pick the token for a remote. Pure — exported for tests. The token is only ever
 * paired with the base of the entry whose hostname equals the remote's.
 */
export function resolveGitLabConfig(
  remoteUrl: string | null,
  vars: Record<string, string | undefined>,
  secretsPath = '~/.config/four-git/secrets.env'
): GitLabConfigResult {
  const hostname = remoteHostname(remoteUrl);
  if (!hostname) {
    return { ok: false, message: 'GitLab not configured (no origin remote with a host)' };
  }

  const matches = collectGitLabHosts(vars).entries.filter((e) => e.hostname === hostname);

  if (matches.length === 0) {
    return {
      ok: false,
      message: `No GitLab token for ${hostname} (set GITLAB_HOST_<NAME>=${hostname} + GITLAB_TOKEN_<NAME> in ${secretsPath})`,
    };
  }
  if (matches.length > 1) {
    const names = matches.map((e) => hostVar(e.label)).join(', ');
    return {
      ok: false,
      message: `GitLab host ${hostname} configured more than once (${names}) — keep one`,
    };
  }

  const entry = matches[0]!;
  if (!entry.token) {
    return { ok: false, message: `No GitLab token for ${hostname} (set ${tokenVar(entry.label)})` };
  }
  return { ok: true, config: { token: entry.token, host: entry.base } };
}

/** `GITLAB_*` from the secrets file, real environment on top. Private object. */
export function gitlabVars(
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  return secretVars('GITLAB_', env);
}

/** Whether the remote's hostname is a configured GitLab host (token or not). */
export function isGitLabHost(
  remoteUrl: string | null,
  vars: Record<string, string | undefined>
): boolean {
  const hostname = remoteHostname(remoteUrl);
  if (!hostname) return false;
  return collectGitLabHosts(vars).entries.some((e) => e.hostname === hostname);
}

/**
 * Resolve the GitLab config for the repo at `cwd`: origin hostname → the one
 * configured entry with that hostname → its token and base. Sources, lowest
 * priority first: `~/.config/four-git/secrets.env`, then the real environment.
 */
export function getGitLabConfig(
  cwd?: string,
  env: Record<string, string | undefined> = process.env
): GitLabConfigResult {
  const path = globalSecretsPath(env);
  if (isGroupOrWorldReadable(path)) {
    warnOnce('gitlab.secrets.mode', `${path} is readable by group/others — chmod 600 it`);
  }

  const vars = gitlabVars(env);
  for (const warning of collectGitLabHosts(vars).warnings) {
    warnOnce(`gitlab.config:${warning}`, warning);
  }

  const result = resolveGitLabConfig(cwd ? originUrl(cwd) : null, vars, path);
  if (!result.ok) logDebugEvent('gitlab.config.missing', { reason: result.message });
  return result;
}

/** Get project ID from current repo's remote origin */
export async function getGitLabProjectId(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', 'remote', 'get-url', 'origin'], { cwd, stdout: 'pipe' });
    const url = (await new Response(proc.stdout).text()).trim();
    // Extract: <EMAIL_1>:group/project.git → group/project
    const match = url.match(/[/:]([^/]+\/[^.]+?)(?:\.git)?$/);
    if (match) {
      return encodeURIComponent(match[1]);
    }
    return null;
  } catch {
    return null;
  }
}

/** Call GitLab v4 API. `path` starts with `projects/...`. */
export async function gitlabApi(
  path: string,
  config: GitLabConfig,
  init?: GitLabApiInit
): Promise<GitLabApiResult> {
  const url = `${config.host}/api/v4/${path}`;

  try {
    const headers: Record<string, string> = {
      'PRIVATE-TOKEN': config.token,
      Accept: 'application/json',
    };

    const opts: RequestInit = {
      method: init?.method ?? 'GET',
      headers,
      // Never follow a redirect: the token must reach only the configured host.
      redirect: 'manual',
    };
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(init.body);
    }

    const response = await fetch(url, opts);
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        status: response.status,
        data: null,
        error: `HTTP ${response.status} redirect to ${response.headers.get('location') ?? '?'} not followed — fix GITLAB_HOST`,
      };
    }
    const data = await response.json().catch(() => null);

    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : (data as any)?.message || `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
