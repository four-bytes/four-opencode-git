// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes
//
// Shared fixtures for tool-level Forgejo tests: a throwaway repo whose origin
// points at an example host, a configured token for it, and a fetch mock that
// records every request and answers from a route table.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const HOST = 'https://forgejo.example.com';
export const API = `${HOST}/api/v1/repos/acme/widgets`;

export interface Recorded {
  method: string;
  url: string;
  body?: any;
}

type Route = (req: Recorded) => { status?: number; json?: unknown } | undefined;

/** A git repo with `origin` at the example host. */
export function exampleRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-forgejo-'));
  Bun.spawnSync(['git', 'init', '-q'], { cwd: dir });
  Bun.spawnSync(['git', 'remote', 'add', 'origin', `${HOST}/acme/widgets.git`], { cwd: dir });
  return dir;
}

/**
 * Configure the example host, install a fetch mock, run `fn`, restore all.
 * Unrouted requests answer 404 so a missing route shows up as a failed call.
 */
export async function withForgejo(
  route: Route,
  fn: (calls: Recorded[]) => Promise<void>
): Promise<void> {
  const calls: Recorded[] = [];
  const realFetch = globalThis.fetch;
  process.env.FORGEJO_HOST_EX = 'forgejo.example.com';
  process.env.FORGEJO_TOKEN_EX = 'test-token';
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const req: Recorded = {
      method: init?.method ?? 'GET',
      url: String(url),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(req);
    const res = route(req) ?? { status: 404, json: { message: 'not found' } };
    return new Response(JSON.stringify(res.json ?? null), { status: res.status ?? 200 });
  }) as unknown as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.FORGEJO_HOST_EX;
    delete process.env.FORGEJO_TOKEN_EX;
  }
}

/** Minimal tool context — the tools only read `directory`. */
export function ctx(directory: string): any {
  return { directory, worktree: directory, sessionID: 't', messageID: 't', agent: 't' };
}
