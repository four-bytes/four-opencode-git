// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

/**
 * Shared label helpers for the provider-agnostic `forge_label_*` tools.
 * Every provider's label is normalized to `{ name, color, description? }`.
 */

import type { Backend } from './forge-resolver';
import { runGh } from './gh-utils';
import { getGitLabConfig, gitlabApi, type GitLabConfig } from './gitlab-utils';
import {
  forgejoApiAll,
  getForgejoConfig,
  resolveLabelIds,
  type ForgejoConfig,
} from './forgejo-utils';

export interface Label {
  name: string;
  color: string;
  description?: string;
}

export interface LabelListResult {
  ok: boolean;
  labels: Label[];
  error?: string;
}

/** How many valid names are echoed back when a requested label is unknown. */
const MAX_VALID_HINT = 15;

/** Normalize a provider label object to the shared shape. */
function normalizeLabel(raw: any): Label {
  const label: Label = {
    name: String(raw?.name ?? ''),
    color: String(raw?.color ?? '').replace(/^#/, ''),
  };
  if (raw?.description) label.description = String(raw.description);
  return label;
}

/** Render the normalized label list. Pure — exported for testing. */
export function formatLabelList(repo: string, backend: Backend, labels: Label[]): string {
  const header = `LABELS — ${repo} [${backend}]`;
  if (labels.length === 0) return `${header} — none`;
  const rows = labels.map((label) => {
    const description = label.description ? `  ${label.description}` : '';
    return `  ${label.name}  #${label.color}${description}`;
  });
  return [header, ...rows].join('\n');
}

/** Refusal line that names the valid labels instead of guessing. Pure — exported for testing. */
export function formatUnknownLabels(unknown: string[], valid: string[]): string {
  const hint = valid.slice(0, MAX_VALID_HINT).join(', ') || '(none)';
  return `✗ Unknown label(s): ${unknown.join(', ')}. Valid labels: ${hint}.`;
}

/** Case-insensitive: requested names that are not in `valid`. Pure — exported for testing. */
export function findUnknownLabels(names: string[], valid: string[]): string[] {
  const known = new Set(valid.map((name) => name.toLowerCase()));
  return names.filter((name) => !known.has(name.trim().toLowerCase()));
}

/** `ff0000` — six hex digits, no leading `#`. Pure — exported for testing. */
export function isValidColor(color: string): boolean {
  return /^[0-9a-fA-F]{6}$/.test(color);
}

// ────────────────────────────────────────────────────────────────
// Listing
// ────────────────────────────────────────────────────────────────

export async function listGithubLabels(repo: string, cwd: string): Promise<LabelListResult> {
  try {
    const raw = await runGh(
      ['api', '--paginate', '--slurp', `repos/${repo}/labels?per_page=100`],
      cwd
    );
    const parsed: unknown = JSON.parse(raw);
    // --slurp wraps all pages in one outer array; flatten to a single label list.
    const data =
      Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])
        ? (parsed as unknown[][]).flat()
        : parsed;
    return { ok: true, labels: Array.isArray(data) ? data.map(normalizeLabel) : [] };
  } catch (err) {
    return { ok: false, labels: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listForgejoLabels(
  repo: string,
  config: ForgejoConfig
): Promise<LabelListResult> {
  const result = await forgejoApiAll(`/repos/${repo}/labels`, config);
  if (!result.ok) return { ok: false, labels: [], error: result.error };
  const data = result.data;
  return { ok: true, labels: Array.isArray(data) ? data.map(normalizeLabel) : [] };
}

export async function listGitlabLabels(
  projectId: string,
  config: GitLabConfig
): Promise<LabelListResult> {
  const result = await gitlabApi(`projects/${projectId}/labels?per_page=100`, config);
  if (!result.ok) return { ok: false, labels: [], error: result.error };
  const data = result.data;
  return { ok: true, labels: Array.isArray(data) ? data.map(normalizeLabel) : [] };
}

// ────────────────────────────────────────────────────────────────
// Validation (shared by apply + remove)
// ────────────────────────────────────────────────────────────────

export interface PreparedLabels {
  ok: boolean;
  /** Refusal or error line when `ok` is false. */
  message?: string;
  /** Requested names, trimmed and non-empty. */
  names: string[];
  /** Forgejo label ids resolved from `names`. */
  ids?: number[];
  /** Forgejo config reused by the following write call. */
  config?: ForgejoConfig;
}

/**
 * Fetch the repo's current labels and reject any requested name that does not
 * exist (case-insensitive) — naming the valid ones. For Forgejo the names are
 * resolved to ids in the same pass so the caller writes once.
 */
export async function prepareLabels(
  backend: Backend,
  repo: string,
  names: string[],
  cwd: string
): Promise<PreparedLabels> {
  if (backend === 'github') {
    const listed = await listGithubLabels(repo, cwd);
    if (!listed.ok) return { ok: false, message: `Error reading labels: ${listed.error}`, names };
    const unknown = findUnknownLabels(names, listed.labels.map((l) => l.name));
    if (unknown.length > 0) {
      return {
        ok: false,
        message: formatUnknownLabels(unknown, listed.labels.map((l) => l.name)),
        names,
      };
    }
    return { ok: true, names };
  }

  if (backend === 'gitlab') {
    const cfg = getGitLabConfig(cwd);
    if (!cfg.ok) return { ok: false, message: cfg.message, names };

    const listed = await listGitlabLabels(repo, cfg.config);
    if (!listed.ok) return { ok: false, message: `Error reading labels: ${listed.error}`, names };
    const unknown = findUnknownLabels(names, listed.labels.map((l) => l.name));
    if (unknown.length > 0) {
      return {
        ok: false,
        message: formatUnknownLabels(unknown, listed.labels.map((l) => l.name)),
        names,
      };
    }
    return { ok: true, names };
  }

  const cfg = getForgejoConfig(cwd);
  if (!cfg.ok) return { ok: false, message: cfg.message, names };

  const resolved = await resolveLabelIds(repo, names, cfg.config);
  if (resolved.error) return { ok: false, message: `Error reading labels: ${resolved.error}`, names };
  if (resolved.unknown.length > 0) {
    const listed = await listForgejoLabels(repo, cfg.config);
    const valid = listed.ok ? listed.labels.map((l) => l.name) : [];
    return { ok: false, message: formatUnknownLabels(resolved.unknown, valid), names };
  }
  return { ok: true, names, ids: resolved.ids, config: cfg.config };
}
