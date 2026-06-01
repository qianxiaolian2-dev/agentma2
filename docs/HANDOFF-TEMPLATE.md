# AgentMa Handoff Template

Use this template for every delivery brief before asking for review. Report all completed work, including opportunistic fixes and supporting changes.

## Requested Scope

- User request:
- Roadmap/review item followed:
- Scope explicitly not included:

## Delivered Scope

- Primary changes:
- Extra changes completed during the same work:
- Behavior changed for users/operators:

## Diff Summary

Paste the full current `git diff --stat` here.

```text

```

## Changed Files by Theme

- Feature/runtime:
- UI:
- Store/API:
- Smoke/tests:
- Docs/process:
- Cleanup/refactor:

## New APIs, Scripts, and Data

- API endpoints:
- npm scripts / smoke scripts:
- Database/schema changes:
- New persistent or temporary files/directories:

## Verification

List the exact commands run and summarize the key result. Include failures that happened before the final passing run.

```text

```

## Smoke Evidence

- Smoke suites run:
- Important checks observed:
- Server/process cleanup result:
- Temporary cwd/run directory cleanup result:

## Known Residual Risk

- Intentional leftovers:
- Flakes or unverified paths:
- Manual checks still recommended:

## Worktree and Commit Status

Paste `git status --short` or summarize it exactly.

```text

```

- Commit created: yes/no
- If no commit, why:
- Untracked files intentionally left:

## Suggested Next Step

- Next roadmap item:
- Decision needed from user:
