# GitHub setup: branch protection, repo variables, Tool Request identity

Moved from the README.

## Branch protection (a human must enable)

The CI guardrails only block merges if GitHub enforces them. On `main` (Settings → Branches, or a ruleset):

1. **Require a pull request before merging**, with at least 1 approval.
2. **Require review from Code Owners** (makes `.github/CODEOWNERS` bite: @anne01liang on everything outside `src/apps/**`). CODEOWNERS names users, not a team, because this repo belongs to a personal account and teams only exist in GitHub organizations. In an org, replace them with a security team that has write access.
3. **Dismiss stale approvals when new commits are pushed** and **require approval of the most recent push**, so a reviewed PR can't change afterwards unreviewed.
4. **Require status checks to pass**, with these required: `checks` (CI), `scope` (tool-request-scope: Tool Request bot PRs may only add one new app), `assess` (risk label + security approval for HIGH-risk tool-request PRs). Also **require branches to be up to date**.
5. **Do not allow bypassing the above settings** (applies to admins too).
6. **Block force pushes and branch deletion.**

Repo variables (Settings → Secrets and variables → Actions → Variables):

- `SECURITY_REVIEWERS`: comma-separated GitHub logins of the security reviewers (today `anne01liang`, matching CODEOWNERS). App code under `src/apps/**` has no code owner, so for a HIGH-risk tool-request PR (it touches `@pii`/`@money` fields or sensitive permissions) `assess` fails until one of them approves the PR's latest commit; it re-runs on every review. A list, because `GITHUB_TOKEN` can't read org team membership; a GitHub App or token with org *Members: read* could replace it with a team lookup. Unset = no one can approve (fails closed).
- `TOOL_REQUEST_BOT_LOGIN`: the GitHub login that Tool Request PRs are opened under (default `devin-ai-integration[bot]`).

A PR that edits a workflow runs its own copy of that workflow, which is why `.github/` changes need code-owner review.

### Production requirement: a dedicated GitHub identity for Tool Request builds

`scope` and the security-review gate key on the PR author. With the default, every PR any Devin session opens (including platform work engineers ask Devin for) is treated as a tool request and fails `scope`. Give Tool Request builds their own login:

1. Create a GitHub machine user (e.g. `acme-tool-builder`) with write access to this repo only.
2. Create a Devin user for it and link its GitHub account (Devin → Settings → Connections → GitHub).
3. Start Tool Request sessions as that Devin user: a v1 personal API key of that user as `DEVIN_API_KEY`, or a v3 service user with `create_as_user_id` (needs `ImpersonateOrgSessions`).
4. In Devin → Settings → Devin → Pull requests, set **Open PRs as: User only**, so a session that can't open the PR as that user fails instead of falling back to `devin-ai-integration[bot]` (which would skip both checks).
5. Set the repo variable `TOOL_REQUEST_BOT_LOGIN=acme-tool-builder`.

A separate Devin GitHub App installation or Devin org doesn't help: every installation opens PRs as `devin-ai-integration[bot]`.
