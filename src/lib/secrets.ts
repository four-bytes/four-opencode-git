// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Machine-wide secrets file: `$XDG_CONFIG_HOME/four-git/secrets.env`.
 *
 * Same contract as `four-opencode-mail`: values are returned to the caller and
 * layered *under* the real environment in a private object — never written into
 * `process.env`, where every other plugin, every `env` shell call and
 * `/proc/<pid>/environ` could read them. An explicit export still wins.
 *
 * Deliberately no project `.env`: a cloned repository must not be able to point
 * a token at a host of its choosing.
 */

const SECRETS_DIR = 'four-git';
const SECRETS_FILENAME = 'secrets.env';

type Env = Record<string, string | undefined>;

/** `$XDG_CONFIG_HOME/four-git/secrets.env`, falling back to `~/.config`. */
export function globalSecretsPath(env: Env = process.env): string {
  const configHome = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(configHome, SECRETS_DIR, SECRETS_FILENAME);
}

/**
 * Parse dotenv syntax: `KEY=value`, optional `export `, one pair of surrounding
 * quotes stripped. `#` starts a comment only at the beginning of a line.
 * Unparseable lines are skipped — one stray line must not disable the plugin.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    out[key] = unquote(withoutExport.slice(eq + 1).trim());
  }

  return out;
}

function unquote(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}

/** Values from the secrets file, or `{}` when it is absent or unreadable. */
export function loadSecretsFile(env: Env = process.env): Record<string, string> {
  const path = globalSecretsPath(env);
  if (!existsSync(path)) return {};
  try {
    return parseEnvFile(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Every variable whose name starts with `prefix`, from the secrets file with the
 * real environment layered on top (per key). Returns a private object.
 */
export function secretVars(prefix: string, env: Env = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadSecretsFile(env))) {
    if (key.startsWith(prefix)) out[key] = value;
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(prefix) && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Whether the secrets file is readable by anyone but its owner. Reported, not
 * enforced — mode bits mean little on a Windows drive under WSL. `null` when
 * the file is absent or cannot be inspected.
 */
export function isGroupOrWorldReadable(path: string): boolean | null {
  try {
    return (statSync(path).mode & 0o077) !== 0;
  } catch {
    return null;
  }
}
