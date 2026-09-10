-- P2.5 (W-ENV, R81-ADDENDUM-B phase S5): migration-ledger reconciliation.
-- Already applied live via the Supabase MCP on 2026-08-27
-- (supabase_migrations.schema_migrations version 20260827080213,
-- "add_missing_fk_covering_indexes"). Backfilled verbatim; every statement
-- is CREATE INDEX IF NOT EXISTS, idempotent by construction.
CREATE INDEX IF NOT EXISTS idx_assistant_queries_created_by ON public.assistant_queries (created_by);
CREATE INDEX IF NOT EXISTS idx_assistant_queries_organization_id ON public.assistant_queries (organization_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON public.conversation_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_organization_id ON public.conversations (organization_id);
CREATE INDEX IF NOT EXISTS idx_memberships_organization_id ON public.memberships (organization_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_notifications_organization_id ON public.notifications (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_accepted_by ON public.org_invites (accepted_by);
CREATE INDEX IF NOT EXISTS idx_org_invites_invited_by ON public.org_invites (invited_by);
CREATE INDEX IF NOT EXISTS idx_todos_organization_id ON public.todos (organization_id);
CREATE INDEX IF NOT EXISTS idx_todos_user_id ON public.todos (user_id);
CREATE INDEX IF NOT EXISTS idx_work_progress_photos_uploaded_by ON public.work_progress_photos (uploaded_by);
