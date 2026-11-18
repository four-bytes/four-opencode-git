// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import {
  forgejoApi,
  getForgejoConfig,
  getForgejoRepo,
  resolveLabelIds,
  splitLabels,
} from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

/** Refusal line for unknown labels. Pure — exported for testing. */
export function formatUnknownLabels(unknown: string[], repo: string): string {
  return `✗ Issue not created — unknown label(s) in ${repo}: ${unknown.join(', ')}. Create them first (e.g. rollout-defekt-labels --apply), then retry.`;
}

/** Success line. Pure — exported for testing. */
export function formatForgejoIssueCreated(raw: any, labels: string[]): string {
  const labelPart = labels.length > 0 ? ` [${labels.join(', ')}]` : '';
  return `✓ Created #${raw?.number}${labelPart} ${raw?.title ?? ''}\n  ${raw?.html_url ?? ''}`.trimEnd();
}

// ────────────────────────────────────────────────────────────────
// Core — reusable, takes an already-resolved repo
// ────────────────────────────────────────────────────────────────

export interface ForgejoIssueCreateInput {
  title: string;
  body: string;
  labels: string[];
}

/** Create a Forgejo issue after resolving label ids. Returns the formatted output plus the created issue number; never throws, never retries the POST. */
export async function createForgejoIssue(
  repo: string,
  input: ForgejoIssueCreateInput,
  cwd: string,
): Promise<{ output: string; number: number | undefined }> {
  const cfg = getForgejoConfig(cwd);
  if (!cfg.ok) return { output: cfg.message, number: undefined };
  const config = cfg.config;

  const resolved = await resolveLabelIds(repo, input.labels, config);
  if (resolved.error) return { output: `Error reading labels: ${resolved.error}`, number: undefined };
  if (resolved.unknown.length > 0) {
    return { output: formatUnknownLabels(resolved.unknown, repo), number: undefined };
  }

  const payload: Record<string, unknown> = { title: input.title, body: input.body };
  if (resolved.ids.length > 0) payload.labels = resolved.ids;

  const result = await forgejoApi(`/repos/${repo}/issues`, config, {
    method: 'POST',
    body: payload,
  });
  if (!result.ok) return { output: `Error creating issue: ${result.error}`, number: undefined };

  return {
    output: formatForgejoIssueCreated(result.data, input.labels),
    number: result.data?.number,
  };
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoIssueCreateTool = tool({
  description:
    'Create a Forgejo issue with labels in one call. Label names are resolved to ids first; any unknown label aborts and nothing is created. Title/body are tool arguments — never passed through a shell. Replaces `fj issue create` + `fj issue edit labels`.',

  args: {
    title: tool.schema.string().describe('Issue title, e.g. "[FEAT] one-sentence change"'),
    body: tool.schema.string().optional().describe('Issue body (markdown)'),
    labels: tool.schema
      .string()
      .optional()
      .describe('Comma-separated label names, e.g. "bug,agent-code,caught-dev"'),
  },

  async execute(args, ctx) {
    const title = (args.title as string)?.trim();
    const body = (args.body as string | undefined) ?? '';
    const labelNames = splitLabels(args.labels as string | undefined);
    const cwd = ctx.directory;

    logDebugEvent('forgejo_issue_create.start', { labels: labelNames });

    try {
      if (!title) return 'Error: title must not be empty.';

      const repo = await getForgejoRepo(cwd);
      if (!repo) return 'Could not determine Forgejo repository from origin remote.';

      const res = await createForgejoIssue(repo, { title, body, labels: labelNames }, cwd);
      logDebugEvent('forgejo_issue_create.done', { issue: res.number });
      return res.output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_issue_create.error', { error: msg });
      return `Error creating issue: ${msg}`;
    }
  },
});
