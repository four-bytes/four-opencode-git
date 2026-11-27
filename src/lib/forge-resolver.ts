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
import { getGitLabProjectId, gitlabVars, isGitLabHost } from './gitlab-utils';

export const BACKENDS = ['github', 'gitlab', 'forgejo'] as const;
export type Backend = (typeof BACKENDS)[number];

export function detectBackend(
  remoteUrl: string | null,
  env: Record<string, string | undefined>
): Backend | null {
  const host = remoteHostname(remoteUrl);
  if (host && (host === 'github.com' || host.endsWith('.github.com'))) return 'github';
  if (isForgejoHost(remoteUrl, env)) return 'forgejo';
  if (host === 'gitlab.com' || isGitLabHost(remoteUrl, env)) return 'gitlab';
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

const SELF_HOSTED_CACHE = new Map<string, 'forgejo' | 'gitlab' | null>();

interface ProbeResult {
  ok: boolean;
  data: any;
}

async function probe(url: string, timeoutMs: number): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'manual', signal: controller.signal });
    if (!res.ok) return { ok: false, data: null };
    const data = await res.json().catch(() => null);
    return { ok: true, data };
  } catch {
    return { ok: false, data: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bounded, read-only, credential-free detection of a self-hosted forge.
 * Gitea/Forgejo expose `/api/v1/version` ({version}), GitLab `/api/v4/version`.
 * Cached per host. Returns null when neither endpoint answers.
 */
export async function detectSelfHostedForge(host: string): Promise<'forgejo' | 'gitlab' | null> {
  const cached = SELF_HOSTED_CACHE.get(host);
  if (cached !== undefined) return cached;

  let result: 'forgejo' | 'gitlab' | null = null;
  const gitea = await probe(`https://${host}/api/v1/version`, 3000);
  if (gitea.ok && typeof (gitea.data as any)?.version === 'string') {
    result = 'forgejo';
  } else {
    const gitlab = await probe(`https://${host}/api/v4/version`, 3000);
    if (gitlab.ok && typeof (gitlab.data as any)?.version === 'string') {
      result = 'gitlab';
    }
  }
  SELF_HOSTED_CACHE.set(host, result);
  return result;
}

/**
 * Sync detection first; when it yields nothing and the opt-in env var is set,
 * probe the self-hosted host (bounded, no credentials). Default: no probing.
 */
export async function resolveBackendWithSelfHosted(
  remoteUrl: string | null,
  env: Record<string, string | undefined>,
  override?: Backend
): Promise<Backend | null> {
  const backend = resolveBackend(remoteUrl, env, override);
  if (backend) return backend;
  const host = remoteHostname(remoteUrl);
  if (!host) return null;
  if (env.FOUR_GIT_AUTO_DETECT_SELF_HOSTED !== '1') return null;
  return detectSelfHostedForge(host);
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
  const backend = await resolveBackendWithSelfHosted(
    remoteUrl,
    { ...process.env, ...forgejoVars(), ...gitlabVars() },
    opts.backend
  );
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
