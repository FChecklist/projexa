-- P2.5 (W-ENV, R81-ADDENDUM-B phase S5): migration-ledger reconciliation.
-- Already applied live via the Supabase MCP on 2026-07-25
-- (supabase_migrations.schema_migrations version 20260725030431,
-- "enable_pgaudit_extension_only_2026_07_24"). Backfilled verbatim;
-- CREATE EXTENSION IF NOT EXISTS is idempotent by construction.
CREATE EXTENSION IF NOT EXISTS pgaudit;
