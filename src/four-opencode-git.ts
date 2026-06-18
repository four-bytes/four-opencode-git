// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import type { Plugin } from '@opencode-ai/plugin';
import { gitDiffTool } from './tools/git-diff';
import { gitLogStructuredTool } from './tools/git-log-structured';
import { curseScoreTool } from './tools/curse-score';
import { busFactorTool } from './tools/bus-factor';
import { implicitCouplingTool } from './tools/implicit-coupling';
import { ownershipTool } from './tools/ownership';
import { blastRadiusTool } from './tools/blast-radius';
import { trendTool } from './tools/trend';
import { prRiskTool } from './tools/pr-risk';
import { ghIssueListTool } from './tools/gh-issue-list';
import { ghIssueCloseTool } from './tools/gh-issue-close';
import { ghPrStatusTool } from './tools/gh-pr-status';
import { ghBranchCleanupTool } from './tools/gh-branch-cleanup';
import { ghReleaseInfoTool } from './tools/gh-release-info';
import { ghPrCreateTool } from './tools/gh-pr-create';
import { ghPrCommentTool } from './tools/gh-pr-comment';
import { ghPrReviewTool } from './tools/gh-pr-review';
import { ghBotReviewTool } from './tools/gh-bot-review';
import { gitlabMrCreateTool } from './tools/gitlab-mr-create';
import { gitlabMrCommentTool } from './tools/gitlab-mr-comment';
import { gitlabMrStatusTool } from './tools/gitlab-mr-status';

const FourOpencodeGit: Plugin = async (_ctx) => {
  return {
    tool: {
      git_diff: gitDiffTool,
      git_log_structured: gitLogStructuredTool,
      curse_score: curseScoreTool,
      bus_factor: busFactorTool,
      implicit_coupling: implicitCouplingTool,
      ownership: ownershipTool,
      blast_radius: blastRadiusTool,
      trend: trendTool,
      pr_risk: prRiskTool,
      gh_issue_list: ghIssueListTool,
      gh_issue_close: ghIssueCloseTool,
      gh_pr_status: ghPrStatusTool,
      gh_branch_cleanup: ghBranchCleanupTool,
      gh_release_info: ghReleaseInfoTool,
      gh_pr_create: ghPrCreateTool,
      gh_pr_comment: ghPrCommentTool,
      gh_pr_review: ghPrReviewTool,
      gh_bot_review: ghBotReviewTool,
      gitlab_mr_create: gitlabMrCreateTool,
      gitlab_mr_comment: gitlabMrCommentTool,
      gitlab_mr_status: gitlabMrStatusTool,
    },
  };
};

export default FourOpencodeGit;
