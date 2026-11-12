# Contributing

## Commits

This repository uses [Conventional Commits](https://www.conventionalcommits.org).
Every commit subject takes the form `type(scope): summary`.

- **Types:** `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `ci`, `build`,
  `chore`, `qa`.
- **Scope** is optional and lowercase — the area touched: `fix(auth): …`,
  `docs(decisions): …`.
- **Summary** is imperative, lowercase, and has no trailing period:
  `fix(auth): reject expired invite links`.
- Mark a breaking change with `!` after the type or scope (`feat(api)!: …`), or
  with a `BREAKING CHANGE:` footer.
- Reference the issue at the end of the subject when there is one:
  `fix(quiz): keep drafts after a failed publish (#123)`.

## Issues

External pull requests are not accepted — file an issue instead. Bug reports,
feature requests and questions each have a template in
[`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE).

## Working in the repo

Read [`AGENTS.md`](AGENTS.md) for the layout, commands, branch/worktree workflow
and pull-request rules.
