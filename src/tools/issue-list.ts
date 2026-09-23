// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { runGit } from '../lib/git-utils';
import { getGitLabConfig, getGitLabProjectId, gitlabApi } from '../lib/gitlab-utils';
import {
  forgejoApi,
  forgejoConfigMessage,
  deriveHostFromRemoteUrl,
  getForgejoConfig,
  getForgejoRepo,
} from '../lib/forgejo-utils';
import { normalizeGitLabIssues } from './gitlab-issue-list';
import { normalizeForgejoIssueListItems } from './forgejo-issue-list';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

const BACKENDS = ['github', 'gitlab', 'forgejo'] as const;
export type Backend = (typeof BACKENDS)[number];

/** Forge-agnostic issue shape. Every backend is normalized to this. */
export interface CommonIssue {
  number: number;
  title: string;
  labels: string[];
  state: string;
  url?: string;
}

export interface IssueQuery {
  state: string;
  label?: string;
  assignee?: string;
  limit: number;
  search?: string;
}

// ────────────────────────────────────────────────────────────────
// Backend detection (pure)
// ────────────────────────────────────────────────────────────────

/** Reduce a URL/host string to a lowercase hostname, tolerating a missing scheme. */
function toHostname(value: string | null | undefined): string | null {
  if (!value) return null;
  const withScheme = value.includes('://') ? value : `https://${value}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Hostname of the `origin` remote URL, or null when it carries none. */
function remoteHostname(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  return toHostname(deriveHostFromRemoteUrl(remoteUrl));
}

/**
 * Detect the issue backend from the origin remote and environment.
 *
 * Precedence (first match wins):
 *   1. remote host contains `github.com`            → github
 *   2. `FORGEJO_TOKEN` set, or remote host equals `FORGEJO_HOST` → forgejo
 *   3. `GITLAB_TOKEN` set, remote host equals `GITLAB_HOST`, or remote host is
 *      `gitlab.com`                                 → gitlab
 *   4. otherwise                                    → null
 *
 * Exported for testing without a repo or network.
 */
export function detectBackend(
  remoteUrl: string | null,
  env: Record<string, string | undefined>
): Backend | null {
  const host = remoteHostname(remoteUrl);

  if (host && (host === 'github.com' || host.endsWith('.github.com'))) return 'github';

  const forgejoHost = toHostname(env.FORGEJO_HOST);
  if (env.FORGEJO_TOKEN || (forgejoHost && host && forgejoHost === host)) return 'forgejo';

  const gitlabHost = toHostname(env.GITLAB_HOST);
  if (
    env.GITLAB_TOKEN ||
    (gitlabHost && host && gitlabHost === host) ||
    host === 'gitlab.com'
  ) {
    return 'gitlab';
  }

  return null;
}

/** Apply an explicit `backend` override, else fall back to detection. */
export function resolveBackend(
  remoteUrl: string | null,
  env: Record<string, string | undefined>,
  override?: Backend
): Backend | null {
  return override ?? detectBackend(remoteUrl, env);
}

/** One-line "no backend" message naming the remote host. */
export function noBackendMessage(remoteUrl: string | null): string {
  const host = remoteHostname(remoteUrl) ?? 'origin remote';
  return `No issue backend for ${host}.`;
}

// ────────────────────────────────────────────────────────────────
// Normalization (pure) — every backend → CommonIssue
// ────────────────────────────────────────────────────────────────

function labelName(label: unknown): string {
  if (typeof label === 'string') return label;
  return (label as { name?: string })?.name ?? String(label);
}

/** GitHub `gh --json` shape: labels `{name}`, url `url`. */
export function normalizeGitHubIssues(raw: unknown): CommonIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((issue: any) => ({
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: (issue.labels || []).map(labelName),
    url: issue.url,
  }));
}

/** Dispatch a raw payload to the matching normalizer. Exported for tests. */
export function normalizeIssues(backend: Backend, raw: unknown): CommonIssue[] {
  switch (backend) {
    case 'github':
      return normalizeGitHubIssues(raw);
    case 'gitlab':
      return normalizeGitLabIssues(raw).map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        url: issue.url,
      }));
    case 'forgejo':
      return normalizeForgejoIssueListItems(raw).map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        url: issue.html_url,
      }));
  }
}

// ────────────────────────────────────────────────────────────────
// Output formatting (pure) — identical regardless of backend
// ────────────────────────────────────────────────────────────────

/**
 * One line per issue: `#N [label] title` — a single label in brackets, brackets
 * omitted when there is no label. The output is byte-identical for every backend
 * so the rule files can stop naming a forge.
 */
export function formatIssueList(issues: CommonIssue[], state = 'open'): string {
  if (issues.length === 0) return `No ${state} issues found.`;
  return issues
    .map((issue) => {
      const labelStr = issue.labels.length > 0 ? ` [${issue.labels[0]}]` : '';
      return `#${issue.number}${labelStr} ${issue.title}`;
    })
    .join('\n');
}

// ────────────────────────────────────────────────────────────────
// Backend fetches
// ────────────────────────────────────────────────────────────────
/** Read the origin remote URL, or null when it cannot be resolved. */
async function getRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const url = await runGit(['remote', 'get-url', 'origin'], cwd);
    return url || null;
  } catch {
    return null;
  }
}

async function fetchGitHubIssues(query: IssueQuery, cwd: string): Promise<CommonIssue[]> {
  const repo = await resolveRepo(undefined, cwd);
  const ghArgs: string[] = [
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    query.state,
    '--limit',
    String(query.limit),
    '--json',
    'number,title,state,labels,assignees,url,updatedAt',
  ];
  if (query.label) ghArgs.push('--label', query.label);
  if (query.assignee) ghArgs.push('--assignee', query.assignee);
  if (query.search) ghArgs.push('--search', query.search);

  const rawJson = await runGh(ghArgs, cwd);
  return normalizeGitHubIssues(JSON.parse(rawJson));
}

async function fetchGitLabIssues(
  query: IssueQuery,
  cwd: string
): Promise<CommonIssue[] | string> {
  const cfg = getGitLabConfig();
  if (!cfg) return 'GitLab not configured (GITLAB_TOKEN not set)';

  const projectId = await getGitLabProjectId(cwd);
  if (!projectId) return 'Could not determine GitLab project ID.';

  const apiState = query.state === 'open' ? 'opened' : query.state;
  const params = new URLSearchParams();
  params.set('state', apiState);
  params.set('per_page', String(query.limit));
  if (query.label) params.set('labels', query.label);
  if (query.assignee) params.set('assignee_username', query.assignee);
  if (query.search) params.set('search', query.search);

  const result = await gitlabApi(`projects/${projectId}/issues?${params.toString()}`);
  if (!result.ok) return `Failed to list issues: ${result.error}`;

  return normalizeIssues('gitlab', result.data);
}

async function fetchForgejoIssues(
  query: IssueQuery,
  cwd: string
): Promise<CommonIssue[] | string> {
  const cfg = getForgejoConfig(cwd);
  if (!cfg.ok) return forgejoConfigMessage(cfg.reason);

  const repo = await getForgejoRepo(cwd);
  if (!repo) return 'Could not determine Forgejo repository from origin remote.';

  const params = new URLSearchParams();
  params.set('state', query.state);
  params.set('limit', String(query.limit));
  if (query.label) params.set('labels', query.label);
  if (query.assignee) params.set('assignee', query.assignee);
  if (query.search) params.set('q', query.search);

  const result = await forgejoApi(`/repos/${repo}/issues?${params.toString()}`, cfg.config);
  if (!result.ok) return `Failed to list issues: ${result.error}`;

  return normalizeIssues('forgejo', result.data);
}

// ────────────────────────────────────────────────────────────────
// Routing map — one backend → one fetch function
// ────────────────────────────────────────────────────────────────

type Fetcher = (query: IssueQuery, cwd: string) => Promise<CommonIssue[] | string>;

const FETCHERS: Record<Backend, Fetcher> = {
  github: fetchGitHubIssues,
  gitlab: fetchGitLabIssues,
  forgejo: fetchForgejoIssues,
};

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const issueListTool = tool({
  description:
    'List issues for the current repository regardless of forge. Detects GitHub/GitLab/Forgejo from the origin remote (override with `backend`) and returns one identical line per issue. Saves ~90% tokens vs. bash→read→parse.',

  args: {
    state: tool.schema
      .string()
      .optional()
      .describe("Issue state filter: 'open', 'closed', or 'all' (default: 'open')"),
    label: tool.schema
      .string()
      .optional()
      .describe('Filter by label (comma-separated for multiple, e.g. "bug,help wanted")'),
    assignee: tool.schema.string().optional().describe('Filter by assignee username'),
    limit: tool.schema
      .number()
      .optional()
      .describe('Maximum number of issues to return (default: 20)'),
    search: tool.schema.string().optional().describe('Search term to filter issues by title/body'),
    backend: tool.schema
      .enum(BACKENDS, 'Force a backend, overriding origin-remote detection')
      .optional(),
  },

  async execute(args, ctx) {
    const state = ((args.state as string) ?? 'open').toLowerCase();
    const label = args.label as string | undefined;
    const assignee = args.assignee as string | undefined;
    const limit = (args.limit as number) ?? 20;
    const search = args.search as string | undefined;
    const override = args.backend as Backend | undefined;
    const cwd = ctx.directory;

    logDebugEvent('issue_list.start', { state, label, assignee, limit, search, override });

    try {
      if (!['open', 'closed', 'all'].includes(state)) {
        return `Error: Invalid state "${state}". Must be "open", "closed", or "all".`;
      }

      const remoteUrl = await getRemoteUrl(cwd);
      const backend = resolveBackend(remoteUrl, process.env, override);
      if (!backend) {
        return noBackendMessage(remoteUrl);
      }

      const query: IssueQuery = { state, label, assignee, limit, search };

      const issues = await FETCHERS[backend](query, cwd);
      if (typeof issues === 'string') return issues;

      logDebugEvent('issue_list.done', { backend, count: issues.length });
      return formatIssueList(issues, state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('issue_list.error', { error: msg });
      return `Error listing issues: ${msg}`;
    }
  },
});
