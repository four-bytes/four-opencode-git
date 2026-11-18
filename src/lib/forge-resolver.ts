// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { runGit } from './git-utils';
import { resolveRepo } from './gh-utils';
import {
  forgejoVars,
  getForgejoRepo,
  isForgejoHost,
  remoteHostname,
} from './forgejo-utils';
import { getGitLabProjectId } from './gitlab-utils';

export const BACKENDS = ['github', 'gitlab', 'forgejo'] as const;
export type Backend = (typeof BACKENDS)[number];

function toHostname(value: string | null | undefined): string | null {
  if (!value) return null;
  const withScheme = value.includes('://') ? value : `https://${value}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function detectBackend(
  remoteUrl: string | null,
  env: Record<string, string | undefined>
): Backend | null {
  const host = remoteHostname(remoteUrl);
  if (host && (host === 'github.com' || host.endsWith('.github.com'))) return 'github';
  if (isForgejoHost(remoteUrl, env)) return 'forgejo';
  const gitlabHost = toHostname(env.GITLAB_HOST);
  if (env.GITLAB_TOKEN || (gitlabHost && host && gitlabHost === host) || host === 'gitlab.com') {
    return 'gitlab';
  }
  return null;
}

export function resolveBackend(
  remoteUrl: string | null,
  env: Record<string, string | undefined>,
  override?: Backend
): Backend | null {
  return override ?? detectBackend(remoteUrl, env);
}

export function noBackendMessage(remoteUrl: string | null): string {
  const host = remoteHostname(remoteUrl) ?? 'origin remote';
  return `No issue backend for ${host}.`;
}

export async function getRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const url = await runGit(['remote', 'get-url', 'origin'], cwd);
    return url || null;
  } catch {
    return null;
  }
}

export interface ForgeContext {
  backend: Backend;
  remoteUrl: string | null;
  hostname: string | null;
  /** owner/repo (github/forgejo) or url-encoded group/project (gitlab). */
  repo: string | null;
}

export type ForgeContextResult =
  | { ok: true; ctx: ForgeContext }
  | { ok: false; message: string };

export async function resolveForgeContext(
  cwd: string,
  opts: { backend?: Backend; repo?: string } = {}
): Promise<ForgeContextResult> {
  const remoteUrl = await getRemoteUrl(cwd);
  const backend = resolveBackend(remoteUrl, { ...process.env, ...forgejoVars() }, opts.backend);
  if (!backend) return { ok: false, message: noBackendMessage(remoteUrl) };

  let repo = opts.repo ?? null;
  if (!repo) {
    try {
      if (backend === 'github') repo = await resolveRepo(undefined, cwd);
      else if (backend === 'forgejo') repo = await getForgejoRepo(cwd);
      else repo = await getGitLabProjectId(cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Could not resolve repository: ${msg}` };
    }
  }
  if (!repo) {
    return { ok: false, message: `Could not determine ${backend} repository from origin remote.` };
  }

  return { ok: true, ctx: { backend, remoteUrl, hostname: remoteHostname(remoteUrl), repo } };
}
