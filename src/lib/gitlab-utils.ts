// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { logDebugEvent } from './debug-logger';

export interface GitLabConfig {
  token: string;
  host: string;
}

/** Read GitLab config from environment */
export function getGitLabConfig(): GitLabConfig | null {
  const token = process.env.GITLAB_TOKEN;
  if (!token) {
    logDebugEvent('gitlab.config.missing', { reason: 'GITLAB_TOKEN not set' });
    return null;
  }
  return {
    token,
    host: process.env.GITLAB_HOST || 'https://gitlab.com',
  };
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

/** Call GitLab API */
export async function gitlabApi(
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: object
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const cfg = getGitLabConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: 'GITLAB_TOKEN not set' };

  const url = `${cfg.host}/api/v4/${path}`;

  try {
    const opts: RequestInit = {
      method,
      headers: {
        'PRIVATE-TOKEN': cfg.token,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);

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
