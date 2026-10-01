// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { logDebugEvent } from './debug-logger';
import { warnOnce } from './plugin-log';
import { globalSecretsPath, isGroupOrWorldReadable, secretVars } from './secrets';

export interface ForgejoConfig {
  token: string;
  /** API base (scheme + host[:port][/subpath]) — always taken from the configured entry. */
  host: string;
}

/**
 * Result of resolving Forgejo config. `ok: false` carries a one-line message the
 * tool returns verbatim — it names host and variable, never a value.
 */
export type ForgejoConfigResult =
  | { ok: true; config: ForgejoConfig }
  | { ok: false; message: string };

export interface ForgejoApiResult {
  ok: boolean;
  status: number;
  data: any;
  error?: string;
}

export interface ForgejoApiInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: object;
}

/** One configured host: `FORGEJO_HOST[_<LABEL>]` + `FORGEJO_TOKEN[_<LABEL>]`. */
export interface ForgejoHostEntry {
  /** `''` for the unlabelled pair, else the `<LABEL>` suffix. */
  label: string;
  /** Lowercase hostname, the only thing matched against the origin remote. */
  hostname: string;
  /** API base built from the configured value. */
  base: string;
  token?: string;
}

const HOST_KEY = /^FORGEJO_HOST(?:_([A-Z0-9_]+))?$/;
const TOKEN_KEY = /^FORGEJO_TOKEN(?:_([A-Z0-9_]+))?$/;

const hostVar = (label: string) => (label ? `FORGEJO_HOST_${label}` : 'FORGEJO_HOST');
const tokenVar = (label: string) => (label ? `FORGEJO_TOKEN_${label}` : 'FORGEJO_TOKEN');

/**
 * Parse a git remote URL into a Forgejo base host (scheme + host, no path).
 * `https://forgejo.example.com/acme/widgets.git` → `https://forgejo.example.com`
 * `git@forgejo.example.com:acme/widgets.git`     → `https://forgejo.example.com`
 * Returns null when the URL carries no derivable host. Exported for testing.
 */
export function deriveHostFromRemoteUrl(url: string): string | null {
  const httpsMatch = url.match(/^(https?:\/\/[^/]+)/);
  if (httpsMatch) return httpsMatch[1]!;

  const sshMatch = url.match(/^[^@]+@([^:]+):/);
  if (sshMatch) return `https://${sshMatch[1]!}`;

  return null;
}

/**
 * Lowercase hostname of a remote URL, or null. Ports are dropped on purpose: an
 * ssh remote's port is the SSH port, not the API port, so only the hostname
 * identifies the forge. Credentials in an https remote are ignored.
 */
export function remoteHostname(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null;
  const base = deriveHostFromRemoteUrl(remoteUrl.trim());
  if (!base) return null;
  try {
    return new URL(base).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** `forgejo.example.com`, `https://forgejo.example.com/`, `https://h:3000/forgejo` → API base. */
function parseConfiguredHost(value: string): { hostname: string; base: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname) return null;
    return {
      hostname: url.hostname.toLowerCase(),
      base: `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
    };
  } catch {
    return null;
  }
}

/**
 * Collect configured hosts from `FORGEJO_*` variables. Pure — exported for tests.
 * A token without its `FORGEJO_HOST[_<LABEL>]` partner is never usable: there is
 * no host it may be sent to. Those, and unparseable host values, are returned as
 * `warnings` (variable names only).
 */
export function collectForgejoHosts(vars: Record<string, string | undefined>): {
  entries: ForgejoHostEntry[];
  warnings: string[];
} {
  const entries: ForgejoHostEntry[] = [];
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

  for (const [key, value] of Object.entries(vars)) {
    const m = key.match(TOKEN_KEY);
    if (!m || !value) continue;
    const label = m[1] ?? '';
    if (vars[hostVar(label)] === undefined) {
      warnings.push(`${key} has no ${hostVar(label)} — the token is never sent`);
    }
  }

  return { entries, warnings };
}

/**
 * Pick the token for a remote. Pure — exported for tests. The token is only ever
 * paired with the base of the entry whose hostname equals the remote's.
 */
export function resolveForgejoConfig(
  remoteUrl: string | null,
  vars: Record<string, string | undefined>,
  secretsPath = '~/.config/four-git/secrets.env'
): ForgejoConfigResult {
  const hostname = remoteHostname(remoteUrl);
  if (!hostname) {
    return { ok: false, message: 'Forgejo not configured (no origin remote with a host)' };
  }

  const matches = collectForgejoHosts(vars).entries.filter((e) => e.hostname === hostname);

  if (matches.length === 0) {
    return {
      ok: false,
      message: `No Forgejo token for ${hostname} (set FORGEJO_HOST_<NAME>=${hostname} + FORGEJO_TOKEN_<NAME> in ${secretsPath})`,
    };
  }
  if (matches.length > 1) {
    const names = matches.map((e) => hostVar(e.label)).join(', ');
    return {
      ok: false,
      message: `Forgejo host ${hostname} configured more than once (${names}) — keep one`,
    };
  }

  const entry = matches[0]!;
  if (!entry.token) {
    return { ok: false, message: `No Forgejo token for ${hostname} (set ${tokenVar(entry.label)})` };
  }
  return { ok: true, config: { token: entry.token, host: entry.base } };
}

/** `FORGEJO_*` from the secrets file, real environment on top. Private object. */
export function forgejoVars(
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  return secretVars('FORGEJO_', env);
}

/** Whether the remote's hostname is a configured Forgejo host (token or not). */
export function isForgejoHost(
  remoteUrl: string | null,
  vars: Record<string, string | undefined>
): boolean {
  const hostname = remoteHostname(remoteUrl);
  if (!hostname) return false;
  return collectForgejoHosts(vars).entries.some((e) => e.hostname === hostname);
}

/** Read the `origin` remote URL, or null. */
function originUrl(cwd: string): string | null {
  try {
    const result = Bun.spawnSync(['git', 'remote', 'get-url', 'origin'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) return null;
    return result.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the Forgejo config for the repo at `cwd`: origin hostname → the one
 * configured entry with that hostname → its token and base. Sources, lowest
 * priority first: `~/.config/four-git/secrets.env`, then the real environment.
 */
export function getForgejoConfig(
  cwd?: string,
  env: Record<string, string | undefined> = process.env
): ForgejoConfigResult {
  const path = globalSecretsPath(env);
  if (isGroupOrWorldReadable(path)) {
    warnOnce('forgejo.secrets.mode', `${path} is readable by group/others — chmod 600 it`);
  }

  const vars = forgejoVars(env);
  for (const warning of collectForgejoHosts(vars).warnings) {
    warnOnce(`forgejo.config:${warning}`, warning);
  }

  const result = resolveForgejoConfig(cwd ? originUrl(cwd) : null, vars, path);
  if (!result.ok) logDebugEvent('forgejo.config.missing', { reason: result.message });
  return result;
}

/** Get `owner/repo` from current repo's remote origin (Forgejo uses raw paths). */
export async function getForgejoRepo(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', 'remote', 'get-url', 'origin'], { cwd, stdout: 'pipe' });
    const url = (await new Response(proc.stdout).text()).trim();
    // Extract: <EMAIL_1>:group/project.git → group/project
    const match = url.match(/[/:]([^/]+\/[^.]+?)(?:\.git)?$/);
    if (match) {
      // Forgejo API paths take raw owner/repo — do NOT encodeURIComponent.
      return match[1]!;
    }
    return null;
  } catch {
    return null;
  }
}

/** Call Forgejo v1 API. `path` starts with `/repos/...`. */
export async function forgejoApi(
  path: string,
  config: ForgejoConfig,
  init?: ForgejoApiInit
): Promise<ForgejoApiResult> {
  const url = `${config.host}/api/v1${path}`;

  try {
    const headers: Record<string, string> = {
      Authorization: `token ${config.token}`,
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
        error: `HTTP ${response.status} redirect to ${response.headers.get('location') ?? '?'} not followed — fix FORGEJO_HOST`,
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
