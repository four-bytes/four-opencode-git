# HISTORY — four-opencode-git

## 0.7.3 — forge_pr_comments + forge_pr_review + forge_pr_merge (#64, part of #55)
- New `forge_pr_comments` / `forge_pr_review` / `forge_pr_merge`: unified PR conversation/review/merge across GitHub/Forgejo; GitLab → clear "not supported".
- Merge method enum spans the Forgejo superset; GitHub rejects `rebase-merge`/`fast-forward-only` with a clear message.
- Extracted cores `getGhPrComments`/`getForgejoPrComments`/`getGhPrReview`/`mergeGhPr`/`mergeForgejoPr` (existing tools delegate, no behavior change).

## 0.7.2 — forge_pr_create + forge_pr_status (#62, part of #55)
- New `forge_pr_create` / `forge_pr_status`: unified PR/MR create + status across GitHub/Forgejo/GitLab; `head`↔`source_branch`, `base`↔`target_branch`, `pr`↔`iid` mapped internally.
- Extracted reusable cores `createGhPr`/`createForgejoPr`/`createGitlabMr` + `getGhPrStatus`/`getForgejoPrStatus`/`getGitlabMrStatus` (existing tools delegate, no behavior change).

## 0.7.1 — forge_issue_get + issue-comment list/create (#60, part of #55)
- New `forge_issue_get`: unified single-issue view (full body) across GitHub/Forgejo with auto-detection.
- New `forge_issue_comment_list` / `forge_issue_comment_create`: unified comment list/create; added the missing GitHub comment implementation (`gh api`, bounded `per_page=100`); Forgejo via existing cores.
- Extracted reusable cores `getGhIssue`/`getForgejoIssue`/`listForgejoIssueComments`/`createForgejoIssueComment` (existing tools delegate, no behavior change).

## 0.7.0 — shared forge resolver + forge_issue_create (#58, part of #55)
- New `src/lib/forge-resolver.ts`: provider detection (`detectBackend`/`resolveBackend`/`noBackendMessage`) moved out of `issue-list.ts` and shared across `forge_*` tools; `resolveForgeContext(cwd, { backend?, repo? })` resolves backend + repo once.
- New `forge_issue_create`: auto-detects GitHub/Forgejo and dispatches to `createGhIssue` / `createForgejoIssue`; GitLab → "not supported yet"; reports the resolved `[backend]` in the result.
- `forgejo-issue-create.ts`: extracted reusable `createForgejoIssue(repo, input, cwd)` core (no behavior change).

## 0.6.2 — issue_view full body (#56)
- `gh_issue_view` and `forgejo_issue_view` now return the full issue body instead of truncating
  at 40 / 20 lines; removed the `truncateBody` helper and updated the tool descriptions

## 0.6.0 — Forgejo repos: list, create, archive (#38)
- **`forgejo_repo_list`**: repositories one line each (`[private]`/`[public]`, `[archived]`,
  description); lists the authenticated user's repos or an org's (`org`), `limit` after
  pagination
- **`forgejo_repo_create`**: create a repo for the user or in an org namespace, private by
  default; undefined fields are omitted from the request; HTTP 409 names the existing repo
- **`forgejo_repo_archive`**: set/clear the `archived` flag via `PATCH /repos/{owner}/{repo}`,
  target defaults to the origin remote's repo; 404 → repo not found
- Forgejo 11 → 14 tools, 29 → 32 total

## 0.5.0 — git_log_structured history search + git_status refs (#25)
- `git_log_structured`: `pickaxe` (`-S`), `grep_diff` (`-G`, mutually exclusive with
  `pickaxe`), `all` (`--all` + ref decoration) and `range` (revision range, placed
  before `--`); existing args are now optional; `range`/`pickaxe` values starting with
  `-` are rejected
- `git_status`: `refs` lists local + remote branches (short hash) with per-local-branch
  ahead/behind against the default branch (`for-each-ref` + `rev-list --left-right
  --count`), capped at 20 refs; a missing default branch or remote is best-effort
- Answers the three previously-denied queries: history search (`-S`), ref listing, diverged-range diff

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
