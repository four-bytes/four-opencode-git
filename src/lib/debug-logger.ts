import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PLUGIN_NAME = 'four-opencode-supertools';
const DEBUG_ENABLED = process.env.CC_DEBUG === 'true';

function getLogPath(): string {
  const today = new Date().toISOString().slice(0, 10);
  const dir = join(homedir(), '.cache', 'opencode', PLUGIN_NAME);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return join(dir, `debug-${today}.jsonl`);
}

export function logDebugEvent(event: string, data: Record<string, unknown>): void {
  if (!DEBUG_ENABLED) return;
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...data,
    });
    appendFileSync(getLogPath(), entry + '\n');
  } catch {
    // Never throw from debug logging
  }
}
