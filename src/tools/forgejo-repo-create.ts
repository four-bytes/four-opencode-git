// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { forgejoApi, getForgejoConfig } from '../lib/forgejo-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Request body
// ────────────────────────────────────────────────────────────────

export interface CreateRepoArgs {
  name: string;
  description?: string;
  private?: boolean;
  auto_init?: boolean;
  default_branch?: string;
}

/**
 * Build the `POST /user/repos` / `POST /orgs/{org}/repos` body.
 * `private` defaults to true, `auto_init` to false; undefined fields are omitted.
 * Pure — exported for testing.
 */
export function buildCreateRepoBody(args: CreateRepoArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: args.name,
    private: args.private ?? true,
    auto_init: args.auto_init ?? false,
  };
  if (args.description !== undefined) body.description = args.description;
  if (args.default_branch !== undefined) body.default_branch = args.default_branch;
  return body;
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

/** Success line. Pure — exported for testing. */
export function formatForgejoRepoCreated(raw: any, fallbackName: string): string {
  const fullName = raw?.full_name ?? fallbackName;
  const url = raw?.html_url;
  return (url ? `✓ Created ${fullName}\n  ${url}` : `✓ Created ${fullName}`).trimEnd();
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const forgejoRepoCreateTool = tool({
  description:
    'Create a Forgejo repository, for the authenticated user or inside an organization (`org`). Private by default; an existing repository is reported by name and nothing is changed.',

  args: {
    name: tool.schema.string().describe('Repository name, e.g. "widgets"'),
    org: tool.schema
      .string()
      .optional()
      .describe('Create the repository in this organization\'s namespace'),
    description: tool.schema.string().optional().describe('Repository description'),
    private: tool.schema
      .boolean()
      .describe('Create a private repository (default: true)'),
    auto_init: tool.schema
      .boolean()
      .describe('Initialize with a README and default branch (default: false)'),
    default_branch: tool.schema
      .string()
      .optional()
      .describe('Default branch name (default: the Forgejo instance setting)'),
  },

  async execute(args, ctx) {
    const name = (args.name as string | undefined)?.trim() ?? '';
    const org = (args.org as string | undefined)?.trim() || undefined;
    const description = args.description as string | undefined;
    const isPrivate = (args.private as boolean | undefined) ?? true;
    const autoInit = (args.auto_init as boolean | undefined) ?? false;
    const defaultBranch = args.default_branch as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('forgejo_repo_create.start', { name, org, private: isPrivate, auto_init: autoInit });

    try {
      if (!name) return 'Error: repository name must not be empty.';

      const cfg = getForgejoConfig(cwd);
      if (!cfg.ok) return cfg.message;

      const body = buildCreateRepoBody({
        name,
        description,
        private: isPrivate,
        auto_init: autoInit,
        default_branch: defaultBranch,
      });

      const path = org ? `/orgs/${org}/repos` : '/user/repos';
      const result = await forgejoApi(path, cfg.config, { method: 'POST', body });

      if (result.status === 409) {
        const data = result.data as any;
        let existing: string | undefined =
          typeof data?.full_name === 'string' ? data.full_name : undefined;
        if (!existing) {
          if (org) {
            existing = `${org}/${name}`;
          } else {
            // Without `org` the target namespace is the authenticated user, not
            // the origin owner — resolve the login from `/user`.
            const who = await forgejoApi('/user', cfg.config);
            const login = (who.ok ? (who.data as any)?.login : undefined) as string | undefined;
            existing = login ? `${login}/${name}` : name;
          }
        }
        return `Repository ${existing} already exists.`;
      }
      if (!result.ok) return `Error creating repository: ${result.error}`;

      logDebugEvent('forgejo_repo_create.done', { repo: result.data?.full_name });
      return formatForgejoRepoCreated(result.data, org ? `${org}/${name}` : name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('forgejo_repo_create.error', { error: msg });
      return `Error creating repository: ${msg}`;
    }
  },
});
