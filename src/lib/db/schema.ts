import { pgTable, uuid, text, timestamp, unique, boolean, jsonb, primaryKey, date, integer } from "drizzle-orm/pg-core";

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
  // drizzle/0025: IANA timezone (e.g. "Asia/Kolkata") used to compute when
  // this org's email-digest schedule slots are due -- see
  // src/lib/email/schedule-service.ts. Defaults to Asia/Kolkata (PROJEXA's
  // primary market) rather than UTC so a newly-provisioned org with no
  // explicit setting still gets a sensible local send time.
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
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
    // PROJEXA-NEXT-001 (2026-09-21): the server-side half of "last-used
    // project", so a fresh browser/device (no veri.rail.project cookie yet)
    // still lands on this person's own last project instead of
    // listProjectsForSelection()'s alphabetical-by-name order. No FK: project
    // ids live in VERIDIAN's own `projects` table, not here (see the header
    // comment above) -- every read of this column is re-validated against the
    // caller's live project list in pickProject()/pickRouteProject(), so a
    // stale id (deleted project, revoked access) is silently ignored rather
    // than trusted. Nullable: unset until the person picks a project once.
    lastProjectId: uuid("last_project_id"),
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
  // UNIQUE as of 2026-08-27 (drizzle/0016_veridian_org_id_unique.sql) --
  // defense-in-depth found via R43_EXEC_03 (false-positive cross-tenant
  // fault investigation): compliance-tracker's own tenant isolation is
  // entirely keyed on this column, so two rows ever sharing a value would
  // be a real leak even though nothing writes a duplicate today.
  veridianOrgId: text("veridian_org_id").notNull().unique(),
  veridianApiKey: text("veridian_api_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per PROJEXA org that has connected the Google Sheets integration
// (see src/lib/google-sheets/). A single PROJEXA-owned Google service
// account creates and owns every org's spreadsheet -- there is no per-org
// Google OAuth token to store, only which spreadsheet belongs to this org
// and the token used to authenticate the sheet's own Apps Script back to
// this app. webhookTokenHash is a sha256 of the raw token embedded in the
// generated Apps Script source (see apps-script-template.ts); the raw token
// itself is never stored, mirroring how this repo never stores a password.
export const googleSheetsIntegration = pgTable("google_sheets_integration", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  spreadsheetId: text("spreadsheet_id").notNull().unique(),
  spreadsheetUrl: text("spreadsheet_url").notNull(),
  webhookTokenHash: text("webhook_token_hash").notNull(),
  status: text("status").notNull().default("idle"), // idle | syncing | error
  lastError: text("last_error"),
  lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
  lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
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
// R48_NO_INVITE_UI_01: org-admin user provisioning (drizzle/0015). The
// invite is bound to its email -- public.accept_org_invite() refuses a token
// whose email does not match the redeeming user's own profile -- so the link
// is a delivery convenience, not a bearer credential.
export const orgInvites = pgTable("org_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  token: text("token").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedBy: uuid("accepted_by").references(() => profiles.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

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

// assigneeId/dueDate/note added 2026-09-16 (WO-PROJEXA-AI-LINK-001): the AI
// Link's verb allowlist (ASSIGN/SET_DUE/NOTE/MARK_STATUS/DRAFT) needs real
// columns to act on -- todos was previously just {text, done}, a flat
// checklist item with nothing for ASSIGN/SET_DUE/NOTE to write to.
// Additive and nullable, so every existing row and query is unaffected.
export const todos = pgTable("todos", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  text: text("text").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  assigneeId: uuid("assignee_id"),
  dueDate: date("due_date"),
  note: text("note"),
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

// ── WO-PROJEXA-AI-LINK-001 (2026-09-16) ───────────────────────────────────
// AI Link: a per-(org, user) token addressing a read-only, personal-data-
// excluded SQL projection (public.ai_link_projection, SECURITY DEFINER --
// see drizzle/0023). The token carries NO authority by itself; RLS is
// enabled with no anon/authenticated policies, same posture as
// veridianCredentials -- readable only by the service_role key from
// src/lib/supabase/service-role.ts.
export const orgAiLink = pgTable("org_ai_link", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// Email-as-the-interface: a membership-scoped one-click action token.
// tokenHash (not the raw token) is stored -- the raw value exists only in
// the emailed link. A real BEFORE INSERT trigger
// (check_email_action_token_org_match, drizzle/0023) rejects any row whose
// membership does not belong to the same org as its target todo -- the
// token IS the enforcement, not an app-layer check a future edit could skip.
export const emailActionToken = pgTable("email_action_token", {
  id: uuid("id").primaryKey().defaultRandom(),
  todoId: uuid("todo_id")
    .notNull()
    .references(() => todos.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  membershipId: uuid("membership_id")
    .notNull()
    .references(() => memberships.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

// ── drizzle/0025: org-configurable start-of-day/end-of-day digest ─────────
// Additive alongside email_action_token above, not a replacement -- the
// existing todos-only one-click flow keeps working unchanged. These tables
// generalize it to a real per-org schedule, multiple entity types, and
// reply-by-email. See src/lib/email/schedule-service.ts,
// src/lib/email/digest.ts, src/lib/email/reply-parser.ts,
// src/lib/services/digest-item-dispatcher.ts.

export const orgEmailSchedule = pgTable(
  "org_email_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(), // 'morning' | 'evening' | 'custom' -- DB CHECK constraint enforces this
    label: text("label").notNull().default(""),
    localTime: text("local_time").notNull(), // "HH:MM", 24h, org-local -- DB CHECK constraint enforces the shape
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.organizationId, t.slot)]
  // NOTE: the real DB constraint (drizzle/0025) is a PARTIAL unique index
  // (only for slot IN ('morning','evening')) so 'custom' rows aren't
  // limited to one -- drizzle-kit can't express a partial index via this
  // builder, so this line exists only so `bun run db:generate` doesn't
  // propose dropping an index it doesn't know is partial. The real,
  // authoritative constraint lives in the migration SQL, applied directly.
);

export const emailDigestRun = pgTable(
  "email_digest_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Nullable: a manual "send me my digest now" run has no schedule behind
    // it. NULLs are distinct under the (scheduleId, localDate) unique
    // constraint, so manual runs never collide with each other or a real one.
    scheduleId: uuid("schedule_id").references(() => orgEmailSchedule.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(), // "YYYY-MM-DD", org-local calendar date this run represents
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    membershipsSent: integer("memberships_sent").notNull().default(0),
    membershipsFailed: integer("memberships_failed").notNull().default(0),
  },
  (t) => [unique().on(t.scheduleId, t.localDate)]
  // The idempotency key: makes it safe for more than one trigger source
  // (the existing vercel.json daily cron + the new GitHub Actions poller)
  // to hit the run endpoint redundantly.
);

export const emailDigestDelivery = pgTable("email_digest_delivery", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable for the same reason emailDigestRun.scheduleId is: a manual
  // "send me my digest now" delivery (buildAndSendDigest called with
  // runId: null) has no run behind it either.
  runId: uuid("run_id").references(() => emailDigestRun.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  membershipId: uuid("membership_id")
    .notNull()
    .references(() => memberships.id, { onDelete: "cascade" }),
  // Reply-To local-part: d-{replyToken}@reply.projexa-ai.com. Plaintext, not
  // hashed -- on its own it only ever resolves to a read (which items were
  // on this delivery); applying a verb also requires the inbound route's
  // From-address-matches-this-membership's-profile check.
  replyToken: text("reply_token").notNull().unique(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailDigestItem = pgTable(
  "email_digest_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => emailDigestDelivery.id, { onDelete: "cascade" }),
    refCode: integer("ref_code").notNull(), // 1-based, per delivery -- what the user types in their reply
    entityType: text("entity_type").notNull(), // 'todo' | 'rfi' | 'submittal' | 'punch_list' | 'billing_milestone'
    entityId: text("entity_id").notNull(), // text, not uuid: VERIDIAN entity ids aren't always uuid-shaped
    allowedVerbs: jsonb("allowed_verbs").notNull().default([]).$type<string[]>(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    appliedVerb: text("applied_verb"),
    appliedPayload: jsonb("applied_payload").$type<Record<string, unknown>>(),
  },
  (t) => [unique().on(t.deliveryId, t.refCode)]
);

export const dailyReportNote = pgTable("daily_report_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  membershipId: uuid("membership_id")
    .notNull()
    .references(() => memberships.id, { onDelete: "cascade" }),
  deliveryId: uuid("delivery_id").references(() => emailDigestDelivery.id, { onDelete: "set null" }),
  rawText: text("raw_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
