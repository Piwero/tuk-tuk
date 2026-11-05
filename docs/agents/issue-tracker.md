# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <n> ...` or `gh issue edit <parent> --add-sub-issue <child>`. Older `gh`: use GitHub's sub-issues API.
- **Blocking**: use GitHub native issue dependencies. `gh issue edit <child> --add-blocked-by <blocker>`; older `gh`: use the dependencies API. A ticket is unblocked when every blocker is closed.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Apply/remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: comment with explanation, then `gh issue close <number>`.

Infer repo from `git remote -v`. File issues only into `Piwero/tuk-tuk`, never into upstream skill repositories. Verify target with `gh repo view --json nameWithOwner` before first issue creation in a session.

## Pull requests as a triage surface

**No.** PRs are not request surfaces for triage.

## Skill operations

When a skill says “publish to the issue tracker,” create a GitHub issue. When it says “fetch the relevant ticket,” read its GitHub issue.
