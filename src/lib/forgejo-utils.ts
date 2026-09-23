// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { logDebugEvent } from './debug-logger';

export interface ForgejoConfig {
  token: string;
  host: string;
}

/**
 * Result of resolving Forgejo config.
 * `ok: false` carries which input was missing so tools can emit a precise message.
 */
export type ForgejoConfigResult =
  | { ok: true; config: ForgejoConfig }
  | { ok: false; reason: 'token' | 'host' };

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

let missingTokenLogged = false;
let missingHostLogged = false;

/**
 * Parse a git remote URL into a Forgejo base host (scheme + host, no path).
 * `https://git.4serv.de/scr/dev-playground.git` → `https://git.4serv.de`
 * `git@git.4serv.de:scr/dev-playground.git`     → `https://git.4serv.de`
 * Returns null when the URL carries no derivable host. Exported for testing.
 */
export function deriveHostFromRemoteUrl(url: string): string | null {
  const httpsMatch = url.match(/^(https?:\/\/[^/]+)/);
  if (httpsMatch) return httpsMatch[1]!;

  const sshMatch = url.match(/^[^@]+@([^:]+):/);
  if (sshMatch) return `https://${sshMatch[1]!}`;

  return null;
}

/** Derive the Forgejo host from the current repo's `origin` remote. */
function deriveHostFromRemote(cwd: string): string | null {
  try {
    const result = Bun.spawnSync(['git', 'remote', 'get-url', 'origin'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) return null;

    return deriveHostFromRemoteUrl(result.stdout.toString().trim());
  } catch {
    return null;
  }
}

/**
 * Read Forgejo config from environment.
 * `FORGEJO_TOKEN` is required. Host comes from `FORGEJO_HOST`, else is derived from
 * the repo's origin remote. When the token is present but no host can be derived the
 * config is treated as absent (`reason: 'host'`) — no public host is invented.
 */
export function getForgejoConfig(cwd?: string): ForgejoConfigResult {
  const token = process.env.FORGEJO_TOKEN;
  if (!token) {
    if (!missingTokenLogged) {
      missingTokenLogged = true;
      logDebugEvent('forgejo.config.missing', { reason: 'FORGEJO_TOKEN not set' });
    }
    return { ok: false, reason: 'token' };
  }

  const host = process.env.FORGEJO_HOST || (cwd ? deriveHostFromRemote(cwd) : null);
  if (!host) {
    if (!missingHostLogged) {
      missingHostLogged = true;
      logDebugEvent('forgejo.config.missing', {
        reason: 'FORGEJO_HOST not set and origin host underivable',
      });
    }
    return { ok: false, reason: 'host' };
  }

  return { ok: true, config: { token, host } };
}

/** One-line not-configured message for a failed config resolution. */
export function forgejoConfigMessage(reason: 'token' | 'host'): string {
  return reason === 'token'
    ? 'Forgejo not configured (FORGEJO_TOKEN not set)'
    : 'Forgejo host not configured (set FORGEJO_HOST)';
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
    };
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(init.body);
    }

    const response = await fetch(url, opts);
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
