# AGENTS.md — four-opencode-git

## Pointer
- Meta-repo: `~/four-opencode-plugins/`
- Repo: `four-bytes/four-opencode-git`
- Package: `@four-bytes/four-opencode-git` v0.1.2
- Build: `bun run build` → `dist/four-opencode-git.js`
- Test: `bun test`

## Tool Stack (20 tools)
### git_analyze — Unified Analysis Dispatcher
Collapses 7 metrics into 1 tool schema. Pass `metric` arg to route:
- `curse_score` — rank files by risk (changes × recency × churn)
- `bus_factor` — ownership concentration per directory
- `implicit_coupling` — co-commit pairs → hidden dependencies
- `ownership` — per-file/directory author breakdown
- `blast_radius` — impact analysis: what breaks when touching a file
- `trend` — curse score trajectory (growing risk detection)
- `pr_risk` — uncommitted change risk (staged + unstaged)

### Git Core (3 tools)
- `git_diff` — structured diff output (staged, file, between refs). Saves ~90% tokens
- `git_status` — repo orientation: branch, upstream, ahead/behind, remote, tree counts. Parses `status --porcelain=v2`; `verbose` appends up to 10 changed paths
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

### Forgejo (4 tools)
- `forgejo_issue_list` — list issues (state/label/assignee), one line per issue
- `forgejo_issue_view` — issue detail, body truncated to ~20 lines, comment count
- `forgejo_issue_close` — close issue with optional API-posted comment (no shell)
- `forgejo_pr_status` — PR state; resolves `closed` + not-merged into `merged_via git-squash` via git

## Architecture
- Entry: `src/four-opencode-git.ts` — registers all 20 tools
- Tools: `src/tools/` — one file per tool; analysis tools export execute fns used by git_analyze dispatcher
- Lib: `src/lib/` — git-utils.ts, gh-utils.ts, gitlab-utils.ts, forgejo-utils.ts, debug-logger.ts, diff-parse.ts
- Tests: `tests/` — bun-native

## Dependencies
- `@opencode-ai/plugin` 1.15.13 (exact pin)
- Bun runtime, ESM modules
- `gh` CLI for GitHub tools, `glab` for GitLab tools
- Forgejo REST API (`FORGEJO_TOKEN`, `FORGEJO_HOST`) — no `fj` CLI dependency

## Loading
```jsonc
// opencode.json
"plugin": ["file:///home/robby/four-opencode-git/dist/four-opencode-git.js"]
```
Optional — omit for projects that don't use git.

- **Console logging:** Plugins MUST use `_client?.app?.log()` for all logging in plugin mode — `console.log` / `console.warn` / `console.error` is ONLY permitted for the initial startup `"init"` message. Console output in plugin mode breaks the terminal UI.
