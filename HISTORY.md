# HISTORY — four-opencode-git

## 0.4.0 — Forgejo PR lifecycle (#17, PR #20)
- **`forgejo_pr_create`**: `head` defaults to the current branch, `base` to the repo default branch
- **`forgejo_pr_merge`**: merge through the API (`POST /pulls/{n}/merge`, default squash + delete
  the remote branch, `head_commit_id` pinned). The PR shows *merged* and `Closes #N` closes the
  issue, replacing the `git merge --squash` workaround
- The merge refuses a merged, closed or unmergeable PR, a missing head commit, unreadable reviews,
  an unresolved human review thread, or a human's requested changes. Bot findings never block.
  405/409 answers become one readable line
- **`forgejo_pr_close`**: close without merging, optional comment
- **`forgejo_pr_comments`**: conversation, review verdicts and inline comments in time order,
  open human threads marked
- **`forgejo_pr_status`** reports mergeability and a `threads` line for open PRs
- Threads are conversations (file + line), resolved only in the Forgejo UI — a reply alone does
  not clear one
- README: workflow walkthrough, token scopes per tool. 25 → 29 tools

## 0.3.0 — Forgejo issue write ops (#16, PR #21)
- **`forgejo_issue_create`**: label names are resolved to ids (repo + org labels) before the
  issue is created; an unknown label aborts and nothing is created
- **`forgejo_issue_comment`** / **`forgejo_issue_comments`**: comment text is a tool argument,
  never a shell string; comments read back one line each
- **`forgejo_issue_close`**: the comment is optional now, and the result says whether a merged
  PR references the issue (zombie check, 500 most recent PRs)
- **Fix:** `getForgejoRepo` read `https://` remotes as `host/owner/repo`, so every `forgejo_*`
  tool failed on HTTPS origins. Replaced by `repoFromRemoteUrl` (https, ssh, scp-style, subpath)
- `forgejoApiAll` pagination: a failed page fails the call instead of returning a partial list
- 22 → 25 tools

## 0.2.0 — Forgejo tokens per host (#15, PR #18)
- **Security fix:** the Forgejo token was sent to whatever host the `origin` remote named — in a
  GitHub repo, to `github.com`. Now a token goes only to the host it is configured for
- Tokens live in `~/.config/four-git/secrets.env` as `FORGEJO_HOST_<NAME>` + `FORGEJO_TOKEN_<NAME>`
  pairs; the origin hostname selects exactly one. Values never enter `process.env`; a project
  `.env` is never read
- Requests never follow redirects. `issue_list` no longer picks Forgejo just because a token exists
- Warnings go to the opencode log (`plugin-log.ts`); the test suite is isolated from `~/.config`
- README: full setup guide (token scopes, secrets file, checks, troubleshooting)
- **Breaking:** `FORGEJO_TOKEN` without `FORGEJO_HOST` no longer works

## 0.1.3 — `issue_list` dispatcher (#13, PR #14)
- One forge-agnostic issue list for GitHub, GitLab and Forgejo, detected from the origin remote,
  one identical line per issue

## 0.1.2 — `git_status` (#11)
- Repo orientation in one call: branch, upstream, ahead/behind, remote, tree counts
  (`status --porcelain=v2`)

## 0.1.1 — Forgejo state queries (#9, PR #10)
- `forgejo_issue_list`, `forgejo_issue_view`, `forgejo_issue_close`, `forgejo_pr_status` over the
  Forgejo REST API; `forgejo_pr_status` tells a PR squash-merged outside the forge from an
  abandoned one

## 0.1.0 — bootstrap (2026-06-18 … 2026-09-05)
- Plugin skeleton; 21 git/GitHub/GitLab tools migrated from supertools, `git_analyze` dispatcher (#1)
- `gh_pr_comment` gains `inReplyTo` for inline review replies (#4)
- Fix: `gh_issue_close` uses `closedByPullRequestsReferences` (#5)
- Fix: `computeTrend` is time-independent via an injectable `now` (#7)
- Console logging rule: `app.log` only, console for the startup line (#2)
