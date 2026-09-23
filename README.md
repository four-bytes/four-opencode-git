# @four-bytes/four-opencode-git

Git analysis + GitHub/GitLab ops tools for opencode agents.

## Installation

```jsonc
// opencode.json
"plugin": ["file:///home/robby/four-opencode-git/dist/four-opencode-git.js"]
```

## Tools (19)

### Git core (2)

- `git_diff` — structured diff output (staged, file, between refs)
- `git_log_structured` — parsed log with author/date/file filters

### Analysis dispatcher (1)

- `git_analyze` — routes `metric` to curse_score, bus_factor, implicit_coupling,
  ownership, blast_radius, trend, pr_risk

### GitHub (9)

- `gh_pr_create`, `gh_pr_comment`, `gh_pr_review`, `gh_pr_status`
- `gh_issue_list`, `gh_issue_close` (zombie detection)
- `gh_branch_cleanup` (dry_run first), `gh_release_info`, `gh_bot_review`

### GitLab (3)

- `gitlab_mr_create`, `gitlab_mr_comment`, `gitlab_mr_status`

### Forgejo (4)

Forgejo's `fj` CLI has no `--json` and no `--format`, and reports an out-of-forge
squash-merge as `Closed`. These tools talk to the Forgejo REST API so state can be
read back reliably.

- `forgejo_issue_list` — list issues (state/label/assignee filters), one line per issue
- `forgejo_issue_view` — issue detail: state, labels, body (~20 lines), comment count
- `forgejo_issue_close` — close an issue with an optional comment (API body argument, no shell)
- `forgejo_pr_status` — PR state, resolving `open` / `merged` / `closed + merged_via git-squash`
  / `closed` (abandoned) by checking git for the head commit

## Configuration

### Forgejo

| Env var | Required | Purpose |
|---|---|---|
| `FORGEJO_TOKEN` | yes | Forgejo API token (`Authorization: token …`). Tools return a one-line "not configured" string when absent. |
| `FORGEJO_HOST` | no | Base host, e.g. `https://git.4serv.de`. When unset, derived from the `origin` remote. If neither is available the config is treated as absent and the tools return `Forgejo host not configured (set FORGEJO_HOST)`. |

The repository (`owner/repo`) is derived from `git remote get-url origin`; `ctx.directory`
is used as the working directory, never `process.cwd()`.

### GitLab

`GITLAB_TOKEN` (required) and `GITLAB_HOST` (defaults to `https://gitlab.com`).

## License

Apache-2.0
