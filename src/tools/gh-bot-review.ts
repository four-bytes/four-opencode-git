// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from '@opencode-ai/plugin';
import { runGh, resolveRepo } from '../lib/gh-utils';
import { logDebugEvent } from '../lib/debug-logger';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface BotFinding {
  bot: string;
  type: string;
  severity: string;
  file: string;
  line: number;
  description: string;
  suggestion: string;
  actionable: boolean;
}

interface BotRawComment {
  id?: number;
  user?: { login?: string };
  state?: string;
  body?: string;
  submitted_at?: string;
  created_at?: string;
}

// ────────────────────────────────────────────────────────────────
// Parsers — exported for testing
// ────────────────────────────────────────────────────────────────

export function parseCodeRabbit(body: string): BotFinding[] {
  const findings: BotFinding[] = [];

  // Match individual file-line findings
  // Pattern: "In `@<file>`:\n- Line <N>: <description>"
  const blockPattern = /In\s+`@?([^`]+)`:\s*([\s\S]*?)(?=\nIn\s+`@|\n\s*```|$)/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockPattern.exec(body)) !== null) {
    const file = blockMatch[1]!.trim();
    const blockContent = blockMatch[2]!;

    // Find line-specific findings within this block
    // Use [^\n]+ to ensure we only capture content on the same line as "Line N:"
    const linePattern = /-\s*Line\s+(\d+):\s*([^\n]+)/g;
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = linePattern.exec(blockContent)) !== null) {
      const line = parseInt(lineMatch[1]!, 10);
      const description = lineMatch[2]!.trim();
      const finding = classifyCoderabbitFinding(description, body, file, line);
      findings.push(finding);
    }
  }

  // Fallback: if no inline findings, check for meta content
  if (findings.length === 0 && body.length > 0) {
    if (
      body.includes('Prompt for AI') ||
      body.includes('finishing touches') ||
      body.includes('review in progress')
    ) {
      findings.push({
        bot: 'coderabbitai',
        type: 'meta',
        severity: 'info',
        file: '',
        line: 0,
        description: 'Review contains AI agent prompt — no inline findings parsed',
        suggestion: 'Read full review body manually',
        actionable: false,
      });
    }
  }

  return findings;
}

function classifyCoderabbitFinding(
  description: string,
  fullBody: string,
  file: string,
  line: number
): BotFinding {
  let type = 'nitpick';
  let severity = 'nitpick';

  if (
    description.includes('peer dependency') ||
    description.includes('version mismatch') ||
    description.includes('dependency')
  ) {
    type = 'peer_dependency';
    severity = 'P1';
  } else if (description.includes('security') || description.includes('supply chain')) {
    type = 'security';
    severity = 'P2';
  } else if (description.includes('Quick win') || description.includes('Consider')) {
    type = 'nitpick';
    severity = 'nitpick';
  } else if (
    description.includes('pin') ||
    description.includes('action') ||
    description.includes('commit hash')
  ) {
    type = 'security';
    severity = 'P2';
  }

  // Try to extract a suggestion from the full body
  const suggestionMatch = fullBody.match(/Update the[^.]*\./);
  const suggestion = suggestionMatch ? suggestionMatch[0] : description;

  return {
    bot: 'coderabbitai',
    type,
    severity,
    file,
    line,
    description,
    suggestion,
    actionable: severity !== 'nitpick',
  };
}

export function parseCubicDev(body: string): BotFinding[] {
  const findings: BotFinding[] = [];

  // Match <file name="..."> blocks
  const filePattern = /<file\s+name="([^"]+)">([\s\S]*?)<\/file>/g;
  let fileMatch: RegExpExecArray | null;

  while ((fileMatch = filePattern.exec(body)) !== null) {
    const file = fileMatch[1]!;
    const fileContent = fileMatch[2]!;

    // Match <violation> children
    const violationPattern =
      /<violation\s+number="(\d+)"\s+location="[^:]*:(\d+)">\s*\n?([\s\S]*?)<\/violation>/g;
    let violationMatch: RegExpExecArray | null;

    while ((violationMatch = violationPattern.exec(fileContent)) !== null) {
      const _violationNum = violationMatch[1]!;
      const line = parseInt(violationMatch[2]!, 10);
      const violationText = violationMatch[3]!.trim();

      // Extract severity P1/P2 and description
      const severityMatch = violationText.match(/^(P[12]):\s*(.*)/s);
      const severity = severityMatch ? severityMatch[1]! : 'P2';
      const description = severityMatch ? severityMatch[2]!.trim() : violationText;

      findings.push({
        bot: 'cubic-dev-ai',
        type: 'bug',
        severity,
        file,
        line,
        description,
        suggestion: '',
        actionable: true,
      });
    }
  }

  return findings;
}

export function parseDependabot(body: string): BotFinding[] {
  const bumpMatch = body.match(/Bumps?\s+(.+?)\s+from\s+(\S+)\s+to\s+(\S+)/i);
  if (bumpMatch) {
    return [
      {
        bot: 'dependabot',
        type: 'dependency',
        severity: 'info',
        file: 'package.json',
        line: 0,
        description: `Bump ${bumpMatch[1]!.trim()} from ${bumpMatch[2]!} to ${bumpMatch[3]!}`,
        suggestion: 'Review changelog for breaking changes, verify CI passes',
        actionable: true,
      },
    ];
  }
  return [];
}

export function parseBotContent(body: string, username: string): BotFinding[] {
  const findings: BotFinding[] = [];

  if (username.includes('coderabbitai')) {
    findings.push(...parseCodeRabbit(body));
  }
  if (username.includes('cubic-dev-ai')) {
    findings.push(...parseCubicDev(body));
  }
  if (username.includes('dependabot')) {
    findings.push(...parseDependabot(body));
  }

  return findings;
}

// ────────────────────────────────────────────────────────────────
// Tool definition
// ────────────────────────────────────────────────────────────────

export const ghBotReviewTool = tool({
  description:
    'Parse AI bot review comments on a PR and extract structured, actionable findings. Reads reviews from coderabbitai, cubic-dev-ai, and dependabot bots. Use BEFORE fixing PR issues to understand what the bots found.',

  args: {
    pr: tool.schema.number().describe('PR number to check'),
    repo: tool.schema
      .string()
      .optional()
      .describe('Repo in owner/repo format (default: current repo from git remote)'),
    bot: tool.schema
      .string()
      .optional()
      .describe('Filter by bot: "coderabbitai", "cubic-dev-ai", "dependabot", or "all" (default)'),
  },

  async execute(args, ctx) {
    const { pr, bot } = args;
    const cwd = ctx.directory;

    logDebugEvent('gh_bot_review.start', { pr, bot });

    try {
      const resolvedRepo = await resolveRepo((args.repo as string | undefined) || undefined, cwd);

      // Fetch reviews
      const reviewsRaw = await runGh(
        [
          'api',
          `repos/${resolvedRepo}/pulls/${pr}/reviews`,
          '--jq',
          'map({id, user: .user.login, state, body, submitted_at})',
        ],
        cwd
      );

      // Fetch issue-level comments (PR comments are stored as issue comments)
      const commentsRaw = await runGh(
        [
          'api',
          `repos/${resolvedRepo}/issues/${pr}/comments`,
          '--jq',
          'map({id, user: .user.login, body, created_at})',
        ],
        cwd
      );

      const findings: BotFinding[] = [];

      // Parse reviews
      let reviews: BotRawComment[] = [];
      try {
        reviews = JSON.parse(reviewsRaw) as BotRawComment[];
      } catch {
        reviews = [];
      }
      if (!Array.isArray(reviews)) reviews = [];

      // Parse comments
      let comments: BotRawComment[] = [];
      try {
        comments = JSON.parse(commentsRaw) as BotRawComment[];
      } catch {
        comments = [];
      }
      if (!Array.isArray(comments)) comments = [];

      const filterBot = (bot as string | undefined) || 'all';
      const allItems = [
        ...reviews.map((r) => ({ user: r.user, body: r.body ?? '' })),
        ...comments.map((c) => ({ user: c.user, body: c.body ?? '' })),
      ];

      for (const item of allItems) {
        const username = item.user?.login ?? '';
        if (
          !username.includes('coderabbitai') &&
          !username.includes('cubic-dev-ai') &&
          !username.includes('dependabot')
        ) {
          continue;
        }
        if (filterBot !== 'all' && !username.includes(filterBot)) continue;

        const extracted = parseBotContent(item.body, username);
        findings.push(...extracted);
      }

      logDebugEvent('gh_bot_review.done', { pr, findings: findings.length });

      if (findings.length === 0) {
        return `No bot findings on PR #${pr}`;
      }

      return JSON.stringify(findings, null, 2);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logDebugEvent('gh_bot_review.error', { error: msg });
      return `Error: ${msg}`;
    }
  },
});
