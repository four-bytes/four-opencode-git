// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

/**
 * User-visible warnings through opencode's log API. Console output would break
 * the TUI, so nothing here falls back to `console.*` — without a client the
 * warning is dropped.
 */

interface LogClient {
  app?: {
    log?: (opts: {
      body: { service: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string };
    }) => unknown;
  };
}

let client: LogClient | undefined;
const warned = new Set<string>();

export function setPluginClient(c: unknown): void {
  client = c as LogClient | undefined;
}

/** Emit `message` once per `key` for the lifetime of the process. Never throws. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  try {
    const result = client?.app?.log?.({
      body: { service: 'four-opencode-git', level: 'warn', message },
    });
    if (result instanceof Promise) result.catch(() => {});
  } catch {
    // Logging must never take a tool down.
  }
}
