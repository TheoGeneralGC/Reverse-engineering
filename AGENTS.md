# Project instructions

This is a monorepo for independent reverse engineering projects. Read the relevant
application README and research records before changing its implementation.

Use the official morluto/rea workflow and the pinned local CLI (`npm run rea --`).
Read the installed `reverse-engineer-anything` SKILL.md for investigation work.
Preserve evidence IDs, target identity/version, coverage limits, and unknowns.
Separate observed runtime behavior, static findings, inference, and design choices.

For each application, maintain a feature inventory and concrete acceptance
scenarios. Only mark a feature verified after both implementation and comparison
against the original have supporting evidence. Static analysis alone does not
prove behavior, complete feature coverage, or full parity.

Do not commit real emails, captures, cookies, OAuth tokens, browser profiles,
extracted vendor code, or installed binaries. Use `.local/` and each project's
`evidence/private/` or `evidence/raw/` directories. Review staged paths before
committing: this remote repository is public.

The user authorized inspection of any existing Superhuman account. That does
not authorize sending emails or invitations to other people. Use explicitly
approved test recipients for delivery tests. Do not destroy or submit existing
user drafts. Ask before account-wide mutations or purchases.

API tests must select `:memory:` or an explicit temporary database through the
actual `databasePath` option, with `env.DATABASE_PATH` set to the same isolated
path when supplying an environment. Never rely on a default database in tests.
For a live database audit, use a read-only SQLite connection; constructing the
application or Store can run migrations and recovery even when jobs are disabled.
