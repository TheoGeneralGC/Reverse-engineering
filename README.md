# Reverse engineering

Monorepo for application reconstructions. Each application owns its implementation,
research, and parity criteria under `apps/<name>`. Shared implementation belongs
in `packages/`; reusable investigation tooling belongs in `tools/` and `scripts/`.

Origin: https://github.com/TheoGeneralGC/Reverse-engineering

## Tooling

Use Node 24.22.1 (or another runtime supported by REA), then `npm ci`.
`npm run rea -- --help` invokes the locked official `rea-agents` package.
The launcher can also use Codex's existing bundled Node when the shell's Node
is unsupported. Set `REA_NODE_BINARY` to override its runtime selection.

REA upstream: https://github.com/morluto/rea. The lockfile pins the installed
release and integrity. CLI access works without an MCP connection.
`npm run rea:setup:plan` previews Codex MCP registration and workflow installation.
Restart Codex after applying MCP configuration changes.

`npm run inspect:superhuman` opens installed Chrome with a dedicated, ignored
profile and a loopback-only debugging endpoint. Sign into Superhuman there for
REA browser capture. Desktop and browser authentication are separate.

## Development dashboard

Run `npm run build:dashboard` then `npm run start:dashboard` and open
http://127.0.0.1:4310 to follow all project inventories, evidence, browser runs
and recorded status changes. See the [dashboard guide](apps/progress-dashboard/README.md).

## Projects

- [Superhuman](apps/superhuman/README.md): browser reconstruction, real email
  providers, and a persistent backend. In active implementation; see the project README for running the development app and outstanding integration access.

Raw captures, mail content, authentication state, extracted app code, and secrets
stay in ignored local directories. Only sanitized findings and synthetic test
fixtures belong in Git history. This repository is public.
