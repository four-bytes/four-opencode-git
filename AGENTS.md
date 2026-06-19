# AGENTS.md — four-opencode-git

## Pointer
- Meta-repo: `~/four-opencode-plugins/`
- Repo: `four-bytes/four-opencode-git`
- Package: `@four-bytes/four-opencode-git` v0.1.0
- Build: `bun run build` → `dist/four-opencode-git.js`
- Test: `bun test`

## Tool Stack (15 tools)
### git_analyze — Unified Analysis Dispatcher
Collapses 7 metrics into 1 tool schema. Pass `metric` arg to route:
- `curse_score` — rank files by risk (changes × recency × churn)
- `bus_factor` — ownership concentration per directory
- `implicit_coupling` — co-commit pairs → hidden dependencies
- `ownership` — per-file/directory author breakdown
- `blast_radius` — impact analysis: what breaks when touching a file
- `trend` — curse score trajectory (growing risk detection)
- `pr_risk` — uncommitted change risk (staged + unstaged)

### Git Core (2 tools)
- `git_diff` — structured diff output (staged, file, between refs). Saves ~90% tokens
- `git_log_structured` — parsed log with author/date/file filters. Saves ~50% tokens

### GitHub (9 tools)
- `gh_pr_create` — create PR with title/body/base/head
- `gh_pr_comment` — add comment to PR
- `gh_pr_review` — fetch review comments + state
- `gh_pr_status` — PR mergeability (reviews, CI, conflicts)
- `gh_issue_list` — list issues with label/assignee/state filters
- `gh_issue_close` — close issue with zombie detection
- `gh_branch_cleanup` — find stale merged branches (dry_run first!)
- `gh_release_info` — structured release metadata
- `gh_bot_review` — parse AI bot reviews (CodeRabbit, cubic-dev)

### GitLab (3 tools)
- `gitlab_mr_create` — create merge request
- `gitlab_mr_comment` — add comment to MR
- `gitlab_mr_status` — check MR state/mergeability/pipelines

## Architecture
- Entry: `src/four-opencode-git.ts` — registers all 15 tools
- Tools: `src/tools/` — one file per tool; analysis tools export execute fns used by git_analyze dispatcher
- Lib: `src/lib/` — git-utils.ts, gh-utils.ts, gitlab-utils.ts, debug-logger.ts, diff-parse.ts
- Tests: `tests/` — 146 tests, bun-native

## Dependencies
- `@opencode-ai/plugin` 1.15.13 (exact pin)
- Bun runtime, ESM modules
- `gh` CLI for GitHub tools, `glab` for GitLab tools

## Loading
```jsonc
// opencode.json
"plugin": ["file:///home/robby/four-opencode-git/dist/four-opencode-git.js"]
```
Optional — omit for projects that don't use git.
