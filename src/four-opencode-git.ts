// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import type { Plugin } from '@opencode-ai/plugin';
import { gitDiffTool } from './tools/git-diff';
import { gitStatusTool } from './tools/git-status';
import { gitLogStructuredTool } from './tools/git-log-structured';
import { gitAnalyze } from './tools/git-analyze';
import { ghIssueListTool } from './tools/gh-issue-list';
import { ghIssueCloseTool } from './tools/gh-issue-close';
import { ghIssueCreateTool } from './tools/gh-issue-create';
import { ghPrStatusTool } from './tools/gh-pr-status';
import { ghBranchCleanupTool } from './tools/gh-branch-cleanup';
import { ghReleaseInfoTool } from './tools/gh-release-info';
import { ghPrCreateTool } from './tools/gh-pr-create';
import { ghPrCommentTool } from './tools/gh-pr-comment';
import { ghPrCommentsTool } from './tools/gh-pr-comments';
import { ghPrReviewTool } from './tools/gh-pr-review';
import { ghPrMergeTool } from './tools/gh-pr-merge';
import { ghPrCloseTool } from './tools/gh-pr-close';
import { ghIssueEditTool } from './tools/gh-issue-edit';
import { ghIssueViewTool } from './tools/gh-issue-view';
import { ghBotReviewTool } from './tools/gh-bot-review';
import { gitlabMrCreateTool } from './tools/gitlab-mr-create';
import { gitlabMrCommentTool } from './tools/gitlab-mr-comment';
import { gitlabMrStatusTool } from './tools/gitlab-mr-status';
import { gitlabIssueListTool } from './tools/gitlab-issue-list';
import { issueListTool } from './tools/issue-list';
import { forgeIssueCreateTool } from './tools/forge-issue-create';
import { forgeIssueCloseTool } from './tools/forge-issue-close';
import { forgeIssueGetTool } from './tools/forge-issue-get';
import { forgeIssueCommentListTool } from './tools/forge-issue-comment-list';
import { forgeIssueCommentCreateTool } from './tools/forge-issue-comment-create';
import { forgePrCreateTool } from './tools/forge-pr-create';
import { forgePrStatusTool } from './tools/forge-pr-status';
import { forgePrCommentsTool } from './tools/forge-pr-comments';
import { forgePrReviewTool } from './tools/forge-pr-review';
import { forgePrMergeTool } from './tools/forge-pr-merge';
import { forgeLabelListTool } from './tools/forge-label-list';
import { forgeLabelCreateTool } from './tools/forge-label-create';
import { forgeLabelApplyTool } from './tools/forge-label-apply';
import { forgeLabelRemoveTool } from './tools/forge-label-remove';
import { forgeReactionAddTool } from './tools/forge-reaction-add';
import { forgeReactionListTool } from './tools/forge-reaction-list';
import { forgejoIssueListTool } from './tools/forgejo-issue-list';
import { forgejoIssueViewTool } from './tools/forgejo-issue-view';
import { forgejoIssueCloseTool } from './tools/forgejo-issue-close';
import { forgejoPrStatusTool } from './tools/forgejo-pr-status';
import { forgejoIssueCreateTool } from './tools/forgejo-issue-create';
import { forgejoIssueCommentTool } from './tools/forgejo-issue-comment';
import { forgejoIssueCommentsTool } from './tools/forgejo-issue-comments';
import { forgejoPrCreateTool } from './tools/forgejo-pr-create';
import { forgejoPrMergeTool } from './tools/forgejo-pr-merge';
import { forgejoPrCloseTool } from './tools/forgejo-pr-close';
import { forgejoPrCommentsTool } from './tools/forgejo-pr-comments';
import { forgejoRepoListTool } from './tools/forgejo-repo-list';
import { forgejoRepoCreateTool } from './tools/forgejo-repo-create';
import { forgejoRepoArchiveTool } from './tools/forgejo-repo-archive';
import { setPluginClient } from './lib/plugin-log';

const FourOpencodeGit: Plugin = async (ctx) => {
  setPluginClient(ctx?.client);
  // Provider-specific tools (gh_*, gitlab_*, forgejo_*) are legacy: off by default,
  // re-enabled with FOUR_GIT_LEGACY_TOOLS=1. Use the forge_* tools instead.
  const legacyEnabled = process.env.FOUR_GIT_LEGACY_TOOLS === '1';

  return {
    tool: {
      // ── Always on: git core, forge-agnostic dispatchers ──
      git_diff: gitDiffTool,
      git_status: gitStatusTool,
      git_log_structured: gitLogStructuredTool,
      git_analyze: gitAnalyze,
      issue_list: issueListTool,
      forge_issue_close: forgeIssueCloseTool,
      forge_issue_create: forgeIssueCreateTool,
      forge_issue_get: forgeIssueGetTool,
      forge_issue_comment_list: forgeIssueCommentListTool,
      forge_issue_comment_create: forgeIssueCommentCreateTool,
      forge_pr_create: forgePrCreateTool,
      forge_pr_status: forgePrStatusTool,
      forge_pr_comments: forgePrCommentsTool,
      forge_pr_review: forgePrReviewTool,
      forge_pr_merge: forgePrMergeTool,
      forge_label_list: forgeLabelListTool,
      forge_label_create: forgeLabelCreateTool,
      forge_label_apply: forgeLabelApplyTool,
      forge_label_remove: forgeLabelRemoveTool,
      forge_reaction_add: forgeReactionAddTool,
      forge_reaction_list: forgeReactionListTool,

      // ── Legacy profile: provider-specific tools ──
      ...(legacyEnabled
        ? {
            gh_issue_list: ghIssueListTool,
            gh_issue_close: ghIssueCloseTool,
            gh_issue_create: ghIssueCreateTool,
            gh_pr_status: ghPrStatusTool,
            gh_branch_cleanup: ghBranchCleanupTool,
            gh_release_info: ghReleaseInfoTool,
            gh_pr_create: ghPrCreateTool,
            gh_pr_comment: ghPrCommentTool,
            gh_pr_comments: ghPrCommentsTool,
            gh_pr_review: ghPrReviewTool,
            gh_pr_merge: ghPrMergeTool,
            gh_pr_close: ghPrCloseTool,
            gh_issue_edit: ghIssueEditTool,
            gh_issue_view: ghIssueViewTool,
            gh_bot_review: ghBotReviewTool,
            gitlab_mr_create: gitlabMrCreateTool,
            gitlab_mr_comment: gitlabMrCommentTool,
            gitlab_mr_status: gitlabMrStatusTool,
            gitlab_issue_list: gitlabIssueListTool,
            forgejo_issue_list: forgejoIssueListTool,
            forgejo_issue_view: forgejoIssueViewTool,
            forgejo_issue_close: forgejoIssueCloseTool,
            forgejo_issue_create: forgejoIssueCreateTool,
            forgejo_issue_comment: forgejoIssueCommentTool,
            forgejo_issue_comments: forgejoIssueCommentsTool,
            forgejo_pr_status: forgejoPrStatusTool,
            forgejo_pr_create: forgejoPrCreateTool,
            forgejo_pr_merge: forgejoPrMergeTool,
            forgejo_pr_close: forgejoPrCloseTool,
            forgejo_pr_comments: forgejoPrCommentsTool,
            forgejo_repo_list: forgejoRepoListTool,
            forgejo_repo_create: forgejoRepoCreateTool,
            forgejo_repo_archive: forgejoRepoArchiveTool,
          }
        : {}),
    },
  };
};

export default FourOpencodeGit;
