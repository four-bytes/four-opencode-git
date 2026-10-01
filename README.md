# @four-bytes/four-opencode-git

Git analysis + GitHub/GitLab ops tools for opencode agents.

## Installation

```jsonc
// opencode.json
"plugin": ["file:///path/to/four-opencode-git/dist/four-opencode-git.js"]
```

## Tools (29)

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

### Forgejo (11)

Forgejo's `fj` CLI has no `--json` and no `--format`, and reports an out-of-forge
squash-merge as `Closed`. These tools talk to the Forgejo REST API so state can be
read back reliably.

- `forgejo_issue_list` — list issues (state/label/assignee filters), one line per issue
- `forgejo_issue_view` — issue detail: state, labels, body (~20 lines), comment count
- `forgejo_issue_create` — create an issue **with labels in one call**; label names are resolved
  to ids first (repo + org labels) and an unknown label aborts before anything is created
- `forgejo_issue_comment` — comment on an issue or PR; text is a tool argument, no shell
- `forgejo_issue_comments` — read comments, one line each (date, author, first line), newest N
- `forgejo_issue_close` — close an issue with an optional comment; reports whether a merged PR
  references it (`Closes #N` in the body or `#N` in the title)
- `forgejo_pr_create` — open a PR; `head` defaults to the current branch, `base` to the repo
  default branch
- `forgejo_pr_status` — PR state, mergeability and open human review threads; resolves
  `closed + merged_via git-squash` for PRs merged outside the forge by checking git
- `forgejo_pr_comments` — conversation, review verdicts and inline comments, one line each;
  marks open human threads
- `forgejo_pr_merge` — merge through the API (default: squash + delete the remote branch).
  Refuses a closed / conflicted PR, an unresolved human review thread, or requested changes —
  bot findings never block. A thread counts as open until it is **resolved** in the Forgejo UI;
  a reply alone does not clear it. The PR then shows **merged** and `Closes #N` closes the issue
- `forgejo_pr_close` — close a PR without merging (abandoned), with an optional comment

#### Workflow on a Forgejo repo

```text
forgejo_issue_create  title="[FEAT] short desc"  labels="enhancement"   → #12
git checkout -b feat/12-short-desc  …  git commit  …  git push -u origin HEAD
forgejo_pr_create     title="feat: short desc (#12)"  body="Closes #12" → !13
forgejo_pr_comments   pr=13        # read reviews; open human threads are marked OPEN
                                   # reply in the thread (Forgejo UI) until the reviewer resolves it;
                                   # forgejo_issue_comment issue=13 posts a general PR comment
forgejo_pr_status     pr=13        # "merge mergeable" + "threads no open human threads"
forgejo_pr_merge      pr=13        # squash, deletes the remote branch, closes #12
git checkout main && git pull --ff-only && git branch -D feat/12-short-desc && git fetch --prune
```

`forgejo_pr_merge` needs the repo to allow the chosen merge style (repo **Settings → Repository
→ Pull requests**) and a token with `repository` read-and-write. If Forgejo answers 405, the
tool says so in one line — check those two first.

## Configuration

### Forgejo

The `forgejo_*` tools (and `issue_list` on a Forgejo remote) talk to the Forgejo REST API
(`/api/v1`). They need one API token per Forgejo instance. No `fj` / `tea` CLI is required.

#### 1. Create a token in Forgejo

On your Forgejo instance: avatar → **Settings** → **Applications** → **Generate new token**.

| Scope | Needed for |
|---|---|
| `issue` — Read | `forgejo_issue_list`, `forgejo_issue_view`, `forgejo_issue_comments`, `forgejo_pr_comments`, `issue_list` |
| `issue` — Read and write | `forgejo_issue_create`, `forgejo_issue_comment`, `forgejo_issue_close`, `forgejo_pr_close` with a comment |
| `repository` — Read | `forgejo_pr_status`, `forgejo_pr_comments` |
| `repository` — Read and write | `forgejo_pr_create`, `forgejo_pr_merge`, `forgejo_pr_close` |

PR conversation comments go through Forgejo's issue endpoints, so the PR tools need the
`issue` scope too. Simplest setup: **`issue` and `repository` both Read and write.**
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
