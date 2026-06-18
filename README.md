# @four-bytes/four-opencode-git

Git analysis + GitHub/GitLab ops tools for opencode agents.

## Installation

```jsonc
// opencode.json
"plugin": ["file:///home/robby/four-opencode-git/dist/four-opencode-git.js"]
```

## Tools (coming in follow-up PRs)

- git_diff, git_log_structured — git history and diffs
- git_analyze — unified analysis dispatcher (curse_score, bus_factor, implicit_coupling, ownership, blast_radius, trend, pr_risk)
- gh_pr_*, gh_issue_*, gh_branch_cleanup, gh_release_info, gh_bot_review — GitHub operations
- gitlab_mr_* — GitLab merge request operations

## License

Apache-2.0
