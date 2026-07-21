# Drizzle Metadata

Snapshot files are currently present through `0011_snapshot.json`. Later migrations are hand-authored SQL files tracked in `_journal.json`, starting with `0012_mfa_failed_audit.sql`.

Before generating a future migration with `drizzle-kit`, regenerate or reconcile the missing snapshots so generated schema history matches the applied SQL sequence.
