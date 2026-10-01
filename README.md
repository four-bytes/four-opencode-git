# @four-bytes/four-opencode-git

Git analysis + GitHub/GitLab ops tools for opencode agents.

## Installation

```jsonc
// opencode.json
"plugin": ["file:///home/robby/four-opencode-git/dist/four-opencode-git.js"]
```

## Tools (22)

### Git core (3)

- `git_diff` — structured diff output (staged, file, between refs)
- `git_status` — repo orientation in one call: branch, upstream, ahead/behind, remote
  and working-tree counts. Parses `git status --porcelain=v2 --branch`; optional
  `verbose` appends up to 10 changed paths
- `git_log_structured` — parsed log with author/date/file filters

#### `git_status` output

```
REPO — widgets
  branch    feat/1303-updated-at-filters → origin/feat/1303-updated-at-filters (ahead 2, behind 0)
  remote    origin  https://forgejo.example.com/acme/widgets.git
  tree      3 staged, 1 unstaged, 2 untracked
```

Clean tree → `tree      clean`; no upstream → `branch    main (no upstream)`; no remote →
the `remote` line is omitted. Detached HEAD reports the 7-char short OID. Pass
`verbose: true` to append up to 10 changed paths. A missing repo returns
`Not a git repository.` rather than throwing.

### Analysis dispatcher (1)

- `git_analyze` — routes `metric` to curse_score, bus_factor, implicit_coupling,
  ownership, blast_radius, trend, pr_risk

### Issue list dispatcher (1)

- `issue_list` — lists issues for the current repository regardless of forge. Detects
  GitHub, GitLab or Forgejo from `git remote get-url origin` and routes internally
  (`runGh` / `gitlabApi` / `forgejoApi`), normalizing every backend to one identical
  line per issue:

  ```
  #1303 [spec-change] Add "updated today/yesterday" filters to invoice list
  #1298 [bug] Vendor stock import: headers already sent
  ```

  Args: `state` (default `open`), `label`, `assignee`, `limit` (default 20), `search`,
  and an optional `backend` (`github` / `gitlab` / `forgejo`) that overrides detection —
  use it when a repo's issues live somewhere other than its forge. An unrecognised host
  returns `No issue backend for <host>.` as a plain string, not an error.

### GitHub (9)

- `gh_pr_create`, `gh_pr_comment`, `gh_pr_review`, `gh_pr_status`
- `gh_issue_list`, `gh_issue_close` (zombie detection)
- `gh_branch_cleanup` (dry_run first), `gh_release_info`, `gh_bot_review`

### GitLab (4)

- `gitlab_mr_create`, `gitlab_mr_comment`, `gitlab_mr_status`
- `gitlab_issue_list` — list issues (state/label/assignee/search filters), one line per
  issue; `repo`/`project` optionally override the origin remote. GitLab's `opened` API
  state is mapped from the user-facing `open`

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

Tokens are stored **per host** in `~/.config/four-git/secrets.env` (`$XDG_CONFIG_HOME`
honoured). Each host is a pair sharing a free-form `<NAME>`:

```bash
mkdir -p ~/.config/four-git
cat > ~/.config/four-git/secrets.env <<'ENV'
FORGEJO_HOST_WORK=forgejo.example.com
FORGEJO_TOKEN_WORK=...
FORGEJO_HOST_CODEBERG=codeberg.org
FORGEJO_TOKEN_CODEBERG=...
ENV
chmod 600 ~/.config/four-git/secrets.env
```

- The `origin` remote's hostname (https or ssh) selects the entry; the token is sent **only**
  to the API base of that entry. A repo whose host has no entry gets a one-line
  `No Forgejo token for <host> …` and no request is made.
- `FORGEJO_HOST_<NAME>` accepts `host`, `https://host`, or `https://host:port/subpath`; the API
  base is built from this value, never from the remote.
- A hostname configured under two names is refused rather than guessed.
- The unlabelled pair `FORGEJO_HOST` + `FORGEJO_TOKEN` still works as one entry. A
  `FORGEJO_TOKEN` without `FORGEJO_HOST` is ignored (warning in the opencode log).
- Requests never follow a redirect — a moved instance returns a one-line error instead of
  carrying the token to the new location.
- An exported variable overrides the file per key (so an exported `FORGEJO_HOST_<NAME>` pairs
  with a file-sourced `FORGEJO_TOKEN_<NAME>`). Values read from the file never enter
  `process.env`. A project `.env` is **not** read — a cloned repo must not be able to redirect
  a token. A group/world-readable file is reported in the opencode log.

The repository (`owner/repo`) is derived from `git remote get-url origin`; `ctx.directory`
is used as the working directory, never `process.cwd()`.

### GitLab

`GITLAB_TOKEN` (required) and `GITLAB_HOST` (defaults to `https://gitlab.com`).

## License

Apache-2.0
