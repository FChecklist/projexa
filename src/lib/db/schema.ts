import { pgTable, uuid, text, timestamp, unique, boolean, jsonb, primaryKey } from "drizzle-orm/pg-core";

// PROJEXA's own tenant/auth/billing schema. All construction domain data
// (BOQ, progress, site diary, budgets, etc.) lives in VERIDIAN -- see
// src/lib/veridian-client.ts. Nothing construction-related is stored here.

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Priority 19 Part 2, Workstream C (drizzle/0009): ISO 3166-1 alpha-2
  // country code, nullable, defaults 'IN'. Deliberately separate from
  // compliance-tracker's own organisations.country (PLATFORM-01 Wave 2) --
  // that column is keyed by a VERIDIAN org_id every real PROJEXA org
  // currently shares (PROJEXA-IDENTITY-BRIDGE-01), so it can't distinguish
  // one PROJEXA tenant from another. This table is genuinely per-tenant
  // (see the Team/Settings page's own confirmed isolation), so this is the
  // real source of truth for country-conditional PROJEXA UI -- see
  // src/hooks/use-org-role.ts.
  country: text("country").default("IN"),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.organizationId)]
);

// One row per PROJEXA org, pointing at that customer's VERIDIAN tenant.
// RLS locks this to service_role only -- read exclusively from trusted
// server code (never a route that could leak it to the browser).
export const veridianCredentials = pgTable("veridian_credentials", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  veridianOrgId: text("veridian_org_id").notNull(),
  veridianApiKey: text("veridian_api_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Generic app/collaboration data for the VeriComposer-style Mode Pills /
// Chain Selector / Chatbox port -- not construction domain data.

// Local history of dispatched /api/v1/projexa/assistant calls. Stands in for
// VERIDIAN's real async Tasks system: dispatchTool() is synchronous and
// VERIDIAN's createTask() requires a real user session (not an API key),
// which PROJEXA's server-side proxy calls don't have.
export const assistantQueries = pgTable("assistant_queries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull(),
  codeReference: text("code_reference").notNull(),
  breadcrumb: text("breadcrumb").notNull(),
  inputs: jsonb("inputs").notNull().default({}),
  result: jsonb("result"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })]
);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Auto-populated by the auth.users insert trigger (see drizzle/0004) --
// never written to directly from application code.
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Real in-app notifications (RFI created, submittal status changed, punch
// list item created -- see src/lib/services/notification-service.ts for the
// real trigger call sites). Shape mirrors compliance-tracker's own
// notifications table (id/userId/title/message/type/isRead/metadata/
// createdAt) with organizationId added, since PROJEXA is multi-tenant and
// compliance-tracker's isn't scoped the same way. RLS follows this repo's
// own established convention (auth.uid() + memberships subquery, see
// drizzle/0002) rather than compliance-tracker's separate app_runtime/
// service_role Postgres roles, which don't exist in this repo.
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("system"),
  isRead: boolean("is_read").notNull().default(false),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const todos = pgTable("todos", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  text: text("text").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Work Progress Report (WPR): links a site photo captured against a daily
// work-progress entry to its stored bytes. Deliberately NOT a duplicate of
// VERIDIAN's real constructionWorkProgressEntries row (quantity/date/
// activity stay sourced from VERIDIAN, the single source of truth --
// duplicating them here would let the two drift). veridianEntryId is a
// plain text FK-by-value into that row's real id (cross-database, so no DB-
// level foreign key is possible); it's the one column construction
// domain has today with no home in VERIDIAN (no photo column on that table,
// and no file-upload API reachable from PROJEXA -- confirmed absent, see
// PROGRESS.md). storagePath points into the `work-progress-photos` Supabase
// Storage bucket (see drizzle/0013).
export const workProgressPhotos = pgTable("work_progress_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  veridianEntryId: text("veridian_entry_id").notNull(),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  storagePath: text("storage_path").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Marketing site lead capture ("Talk to an Engineer" -- see
// src/components/marketing/ContactForm.tsx). Public, unauthenticated,
// anonymous-visitor rows -- same reasoning as compliance-tracker's own
// contact_submissions table: these rows belong to a visitor, not a tenant,
// so no organizationId FK and no RLS/tenant scoping. text id (cuid2, via
// @paralleldrive/cuid2 -- already a dependency of this repo) rather than
// this schema's usual uuid().defaultRandom(), matching that same sibling
// table's own id shape.
// R-A1 / TC-R-A1-20260824: platform-level security events (not tenant-
// scoped -- same reasoning as contactRequests above). First and, as of this
// migration, only writer is the rotate-demo-password-r38 Edge Function,
// which appends exactly one row here after it rotates the public demo
// admin's password (demo_manager@projexa-ai.com) -- never the password
// itself, only the fact and time that a rotation happened. Gives this
// requirement a real, queryable audit trail instead of relying solely on
// Supabase Auth's internal (not app-visible) audit_log_entries table.
export const securityAuditLog = pgTable("security_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  event: text("event").notNull(),
  targetUserId: uuid("target_user_id"),
  targetEmail: text("target_email"),
  actor: text("actor").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contactRequests = pgTable("contact_requests", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  phone: text("phone"),
  message: text("message"),
  // Which marketing page the visitor submitted from -- "home" or
  // "how-it-works" today (see ContactForm's sourcePage prop).
  sourcePage: text("source_page"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
