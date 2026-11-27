// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

/**
 * Host/URL helpers shared by the Forgejo and GitLab config resolvers.
 *
 * Every function here is provider-agnostic: it only knows about git remote URLs
 * and configured host values, never about a token variable.
 */

/**
 * Parse a git remote URL into a forge base host (scheme + host, no path).
 * `https://forgejo.example.com/acme/widgets.git` → `https://forgejo.example.com`
 * `git@forgejo.example.com:acme/widgets.git`     → `https://forgejo.example.com`
 * Returns null when the URL carries no derivable host.
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

/**
 * `forgejo.example.com`, `https://forgejo.example.com/`, `https://h:3000/forgejo`
 * → API base. Returns null for a value that is not an http(s) URL with a host.
 */
export function parseConfiguredHost(
  value: string
): { hostname: string; base: string } | null {
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

/** Read the `origin` remote URL for `cwd`, or null. */
export function originUrl(cwd: string): string | null {
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
