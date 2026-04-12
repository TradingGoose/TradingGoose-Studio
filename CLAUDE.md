# CLAUDE.md

## Git Rules

- **NEVER push directly to `staging` or `main` branches.** Always create a feature branch and open a PR.
- Feature branches must be created from the latest `staging` branch (`git checkout -b feat/xxx origin/staging`).
- PRs can only target `staging`. Never open a PR directly to `main`.

## Protected Files

- **NEVER edit any files under `*/migrations/*` directories.** Migration files are immutable once created.
