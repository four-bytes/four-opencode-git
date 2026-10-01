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

The `forgejo_*` tools (and `issue_list` on a Forgejo remote) talk to the Forgejo REST API
(`/api/v1`). They need one API token per Forgejo instance. No `fj` / `tea` CLI is required.

#### 1. Create a token in Forgejo

On your Forgejo instance: avatar → **Settings** → **Applications** → **Generate new token**.

| Scope | Needed for |
|---|---|
| `issue` — Read | `forgejo_issue_list`, `forgejo_issue_view`, `issue_list` |
| `issue` — Read and write | `forgejo_issue_close` (and creating / commenting on issues) |
| `repository` — Read | `forgejo_pr_status` |
| `repository` — Read and write | creating, merging and closing pull requests |

Copy the token right away — Forgejo shows it only once.

#### 2. Store it in the secrets file

One **pair per host**. `<NAME>` is any label you choose (`A-Z`, `0-9`, `_`); it only links
the host to its token.

```bash
mkdir -p ~/.config/four-git
cat > ~/.config/four-git/secrets.env <<'ENV'
# work instance
FORGEJO_HOST_WORK=forgejo.example.com
FORGEJO_TOKEN_WORK=paste-token-here
# a second instance — add as many pairs as you need
FORGEJO_HOST_CODEBERG=codeberg.org
FORGEJO_TOKEN_CODEBERG=paste-token-here
ENV
chmod 600 ~/.config/four-git/secrets.env
```

`FORGEJO_HOST_<NAME>` accepts `forgejo.example.com`, `https://forgejo.example.com`, or a full
base with port / subpath such as `https://forgejo.example.com:3000/forgejo`. If
`$XDG_CONFIG_HOME` is set, the file lives at `$XDG_CONFIG_HOME/four-git/secrets.env`.
The file is read on every call — no opencode restart needed after editing it.

#### 3. Check it

```bash
# the token works (expects your user as JSON)
curl -s -H "Authorization: token <token>" https://forgejo.example.com/api/v1/user
# the repo's origin hostname matches FORGEJO_HOST_<NAME>
git remote get-url origin
```

Then, in opencode inside that repo, `forgejo_issue_list` should list issues.

#### How the token is protected

- The `origin` remote's **hostname** (https or ssh remote, ports ignored) selects exactly one
  entry. The token is sent **only** to that entry's configured base — never to a host taken
  from the remote, so a GitHub or unknown repo never receives a Forgejo token.
- Requests never follow a redirect; a moved instance returns a one-line error instead.
- Values read from the file never enter `process.env`, so other plugins and shell tools
  cannot see them.
- A project `.env` is **not** read — a cloned repository must not be able to redirect a token.
- An exported variable overrides the file for the same key (useful for a one-off test).
- The unlabelled pair `FORGEJO_HOST` + `FORGEJO_TOKEN` still works as one entry.

#### Troubleshooting

| Message | Fix |
|---|---|
| `No Forgejo token for <host> (set FORGEJO_HOST_<NAME>=<host> + FORGEJO_TOKEN_<NAME> …)` | Add a pair for that host. The hostname must equal the one in `git remote get-url origin`. |
| `No Forgejo token for <host> (set FORGEJO_TOKEN_<NAME>)` | The host is configured but its token line is missing or empty. |
| `Forgejo host <host> configured more than once (…)` | Two names point at the same host — delete one pair. |
| `Forgejo not configured (no origin remote with a host)` | The repo has no `origin`, or its URL has no host. |
| `HTTP 302 redirect to … not followed — fix FORGEJO_HOST` | Set `FORGEJO_HOST_<NAME>` to the final URL (e.g. `https://` instead of `http://`, or the new domain). |
| `HTTP 401` / `HTTP 403` | Token expired, revoked, or missing a scope from step 1. |

Warnings that do not fail a call — a group/world-readable secrets file, a `FORGEJO_TOKEN_<NAME>`
without its `FORGEJO_HOST_<NAME>` — appear once in the opencode log (service
`four-opencode-git`).

The repository (`owner/repo`) is derived from `git remote get-url origin`; `ctx.directory`
is used as the working directory, never `process.cwd()`.

### GitLab

`GITLAB_TOKEN` (required) and `GITLAB_HOST` (defaults to `https://gitlab.com`).

## License

Apache-2.0
