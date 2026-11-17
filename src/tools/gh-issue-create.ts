// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Input normalization
// ────────────────────────────────────────────────────────────────

/** Split a comma-separated list, trimming and dropping empty entries. */
export function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Requested names that do not exist in the known list (case-insensitive). Pure. */
export function findUnknown(requested: string[], known: string[]): string[] {
  const knownSet = new Set(known.map((name) => name.toLowerCase()));
  return requested.filter((name) => !knownSet.has(name.toLowerCase()));
}

/** Split newline-separated `gh api --jq` output into trimmed non-empty lines. */
function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

/** Refusal line for unknown labels. Pure — exported for testing. */
export function formatUnknownLabels(unknown: string[], repo: string): string {
  return `✗ Issue not created — unknown label(s) in ${repo}: ${unknown.join(', ')}. Create them first, then retry.`;
}

/** Refusal line for unknown assignees. Pure — exported for testing. */
export function formatUnknownAssignees(unknown: string[], repo: string): string {
  return `✗ Issue not created — unknown assignee(s) in ${repo}: ${unknown.join(', ')}. Create them first, then retry.`;
}

/** Success output. Pure — exported for testing. */
export function formatGhIssueCreated(raw: any, labels: string[], assignees: string[]): string {
  const refs: string[] = [];
  if (labels.length > 0) refs.push(`[labels: ${labels.join(',')}]`);
  if (assignees.length > 0) refs.push(`[assignees: ${assignees.join(',')}]`);

  const base = `✓ Created #${raw?.number} ${raw?.title ?? ''}\n  ${raw?.html_url ?? ''}`.trimEnd();
  return refs.length > 0 ? `${base} ${refs.join(' ')}` : base;
}

// ────────────────────────────────────────────────────────────────
// Core — reusable, takes an already-resolved repo
// ────────────────────────────────────────────────────────────────

export interface GhIssueCreateInput {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
}

/**
 * Create a GitHub issue after validating labels and assignees.
 * Returns a formatted result/refusal string; never throws, never retries the POST.
 */
export async function createGhIssue(
  repo: string,
  input: GhIssueCreateInput,
  cwd: string
): Promise<string> {
  // ── Step 1: validate labels (one request) ──
  if (input.labels.length > 0) {
    const known = splitLines(
      await runGh(['api', `repos/${repo}/labels?per_page=100`, '--jq', '.[].name'], cwd)
    );
    const unknown = findUnknown(input.labels, known);
    if (unknown.length > 0) return formatUnknownLabels(unknown, repo);
  }

  // ── Step 2: validate assignees (one request) ──
  if (input.assignees.length > 0) {
    const known = splitLines(
      await runGh(['api', `repos/${repo}/assignees?per_page=100`, '--jq', '.[].login'], cwd)
    );
    const unknown = findUnknown(input.assignees, known);
    if (unknown.length > 0) return formatUnknownAssignees(unknown, repo);
  }

  // ── Step 3: create — exactly one POST ──
  const ghArgs: string[] = [
    'api',
    `repos/${repo}/issues`,
    '-f',
    `title=${input.title}`,
    '-f',
    `body=${input.body}`,
  ];
  for (const label of input.labels) ghArgs.push('-f', `labels[]=${label}`);
  for (const assignee of input.assignees) ghArgs.push('-f', `assignees[]=${assignee}`);

  const rawJson = await runGh(ghArgs, cwd);

  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return `Error parsing gh api output. Raw output:\n${rawJson}`;
  }

  return formatGhIssueCreated(parsed, input.labels, input.assignees);
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghIssueCreateTool = tool({
  description:
    'Create a GitHub issue. Resolves owner/repo from an explicit argument or the current repo; validates labels/assignees against the repo first — any unknown label or assignee aborts and nothing is created. Title/body are tool arguments (never shell). Returns a compact reference. Saves ~90% tokens vs. bash→gh issue create.',

  args: {
    title: tool.schema.string().describe('Issue title, e.g. "[FEAT] one-sentence change"'),
    body: tool.schema.string().optional().describe('Issue body (markdown)'),
    labels: tool.schema
      .string()
      .optional()
      .describe('Comma-separated label names, e.g. "bug,agent-code,caught-dev"'),
    assignees: tool.schema
      .string()
      .optional()
      .describe('Comma-separated GitHub logins, e.g. "alice,bob"'),
    repo: tool.schema
      .string()
      .optional()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
  },

  async execute(args, ctx) {
    const title = (args.title as string)?.trim();
    const body = ((args.body as string | undefined) ?? '').trim();
    const labels = splitList(args.labels as string | undefined);
    const assignees = splitList(args.assignees as string | undefined);
    const repo = args.repo as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('gh_issue_create.start', { repo, labels, assignees });

    try {
      if (!title) return 'Error: title must not be empty.';

      const resolvedRepo = await resolveRepo(repo, cwd);
      const output = await createGhIssue(resolvedRepo, { title, body, labels, assignees }, cwd);

      logDebugEvent('gh_issue_create.done', { repo: resolvedRepo });
      return output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_issue_create.error', { error: msg });
      return `Error creating issue: ${msg}`;
    }
  },
});
