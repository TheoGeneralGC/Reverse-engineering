# Hosted tracking server configuration

This checkpoint adds server-only JSON configuration for the existing tracking
collector. The loader accepts either the existing private-file mode or bounded
JSON inputs, refuses mixed modes and retains the existing signer and operator
proof validation. Worker startup validates that material before opening Mail or
Control storage or acquiring ownership; the child still uses its fenced transport.
Temporary key buffers are cleared. There is no new tracking preference default.

The exact two runtime edits and four synthetic test/fixture additions were
transplanted onto public29ecfdce. The other732 source paths stayed exact, including
the current Google synchronization scheduler, Command/Ask AI UI and downloads.
The affected25 controls and strict types pass with no external attempts. They
cover malformed/mixed inputs, credential projection, preflight ordering, false
preference receipt persistence through actual isolated worker exits, and a pending
collector permit revoked before issue. All test databases are explicit isolated
paths. An earlier sandbox run stopped three owned-loopback cases at EPERM;
the unchanged cases passed with scoped loopback access. Its failed receipt remains
separate from the final25-control result.

The user separately approved four Production-only Secret variables for the same
project: TRACKING_MAIN_SIGNER_JSON, TRACKING_OPERATOR_VERIFICATION_JSON,
TRACKING_PUBLIC_ORIGIN and TRACKING_COLLECTOR_SOURCE_IDENTITY. Their transfer was
acknowledged and a fresh values-free comparison preserved all22 existing variable
bindings and the deployment-protection configuration. No credential values,
mail tokens, private captures or configuration files are published here.

The predeployment read-only audit found Read Statuses and Recent Opens OFF,
with no tracking delivery or read-history records. This checkpoint does not
enable them, send mail or fetch a tracking image. Loading valid server
configuration is distinct from an enabled account or a successful tracked
delivery. Live capability observation, current-source Original comparison and
complete tracking parity remain separate acceptance steps. All22 feature
families remain open and unverified.
