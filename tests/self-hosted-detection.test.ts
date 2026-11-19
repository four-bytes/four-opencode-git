// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { detectSelfHostedForge, resolveBackendWithSelfHosted } from '../src/lib/forge-resolver';

const realFetch = globalThis.fetch;
let calls: string[];

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string) => Response): void {
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    calls.push(url);
    return handler(url);
  }) as typeof globalThis.fetch;
}

function versionResponse(version: string): Response {
  return new Response(JSON.stringify({ version }), { status: 200 });
}

function notFound(): Response {
  return new Response('', { status: 404 });
}

describe('detectSelfHostedForge', () => {
  it('detects Forgejo/Gitea from /api/v1/version', async () => {
    stubFetch((url) =>
      url.endsWith('/api/v1/version') ? versionResponse('1.21.0') : notFound()
    );
    expect(await detectSelfHostedForge('gitea-h.example')).toBe('forgejo');
  });

  it('falls back to /api/v4/version and detects GitLab', async () => {
    stubFetch((url) =>
      url.endsWith('/api/v1/version')
        ? notFound()
        : url.endsWith('/api/v4/version')
          ? versionResponse('16.0.0')
          : notFound()
    );
    expect(await detectSelfHostedForge('gitlab-h.example')).toBe('gitlab');
  });

  it('returns null when neither endpoint answers', async () => {
    stubFetch(() => notFound());
    expect(await detectSelfHostedForge('nothing-h.example')).toBeNull();
  });

  it('caches the result per host without re-fetching', async () => {
    stubFetch((url) => (url.endsWith('/api/v1/version') ? versionResponse('1.21.0') : notFound()));

    expect(await detectSelfHostedForge('cache-h.example')).toBe('forgejo');
    const afterFirst = calls.length;
    expect(afterFirst).toBe(1);

    expect(await detectSelfHostedForge('cache-h.example')).toBe('forgejo');
    expect(calls.length).toBe(afterFirst);
  });
});

describe('resolveBackendWithSelfHosted', () => {
  it('does not probe when the opt-in env var is unset', async () => {
    stubFetch(() => notFound());
    const backend = await resolveBackendWithSelfHosted('https://unknown.example/x/y.git', {
      FOUR_GIT_AUTO_DETECT_SELF_HOSTED: undefined,
    });
    expect(backend).toBeNull();
    expect(calls.length).toBe(0);
  });

  it('probes the self-hosted host when opted in', async () => {
    stubFetch((url) => (url.endsWith('/api/v1/version') ? versionResponse('1.21.0') : notFound()));
    const backend = await resolveBackendWithSelfHosted('https://unknown.example/x/y.git', {
      FOUR_GIT_AUTO_DETECT_SELF_HOSTED: '1',
    });
    expect(backend).toBe('forgejo');
  });
});
