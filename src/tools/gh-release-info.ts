// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface AssetInfo {
  name: string;
  size: number;
  downloadCount: number;
  url: string;
}

interface ReleaseInfo {
  tagName: string;
  name: string | null;
  body: string;
  publishedAt: string;
  url: string;
  assets: AssetInfo[];
}

// ────────────────────────────────────────────────────────────────
// Output formatting
// ────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatReleaseInfo(release: ReleaseInfo, repo: string): string {
  const lines: string[] = [];
  const title = release.name || release.tagName;
  const dateStr = release.publishedAt.slice(0, 10);

  lines.push(`GH RELEASE — ${repo}`);
  lines.push('');
  lines.push(`  Tag:        ${release.tagName}`);
  lines.push(`  Title:      ${title}`);
  lines.push(`  Published:  ${dateStr}`);
  lines.push(`  URL:        ${release.url}`);

  // ── Release notes ──
  if (release.body && release.body.trim()) {
    lines.push('');
    lines.push('  Release Notes:');
    // Indent each line of the body by 4 spaces
    const bodyLines = release.body.split('\n');
    for (const bl of bodyLines) {
      lines.push(`    ${bl}`);
    }
  }

  // ── Assets ──
  if (release.assets && release.assets.length > 0) {
    lines.push('');
    lines.push(`  Assets (${release.assets.length}):`);
    for (const asset of release.assets) {
      lines.push(
        `    • ${asset.name} — ${formatSize(asset.size)} — ${asset.downloadCount} downloads`
      );
    }
  } else {
    lines.push('');
    lines.push('  Assets:     none');
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghReleaseInfoTool = tool({
  description:
    'Get structured release metadata — version, tag, date, notes, assets. Wraps `gh release view --json`. Saves ~90% tokens vs. bash→read→parse. Defaults to latest release if no tag specified.',

  args: {
    tag: tool.schema
      .string()
      .describe('Release tag to view (e.g., "v1.0.0"). Omit for latest release.'),
    repo: tool.schema
      .string()
      .describe('GitHub repo in owner/repo format (defaults to current repo)'),
  },

  async execute(args, ctx) {
    const tag = args.tag as string | undefined;
    const repo = args.repo as string | undefined;
    const cwd = ctx.directory;

    logDebugEvent('gh_release_info.start', { tag: tag ?? 'latest' });

    try {
      const resolvedRepo = await resolveRepo(repo, cwd);

      // Build gh args
      const ghArgs: string[] = [
        'release',
        'view',
        '--repo',
        resolvedRepo,
        '--json',
        'tagName,name,body,publishedAt,url,assets',
      ];

      // If tag specified, add it; otherwise gh release view defaults to latest
      if (tag) {
        ghArgs.push(tag);
      }

      const rawJson = await runGh(ghArgs, cwd);

      let release: ReleaseInfo;
      try {
        release = JSON.parse(rawJson) as ReleaseInfo;
      } catch {
        return `Error parsing gh release view output. Raw output:\n${rawJson}`;
      }

      logDebugEvent('gh_release_info.done', { tag: release.tagName });
      return formatReleaseInfo(release, resolvedRepo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebugEvent('gh_release_info.error', { error: msg });
      if (msg.includes('No release found')) {
        return `Error: No release found${tag ? ` for tag "${tag}"` : ''} in ${repo || 'current repo'}.`;
      }
      return `Error getting release info: ${msg}`;
    }
  },
});

export { formatReleaseInfo };
