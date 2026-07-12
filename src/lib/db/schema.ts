import { pgTable, uuid, text, timestamp, unique, boolean, jsonb, primaryKey } from "drizzle-orm/pg-core";

// PROJEXA's own tenant/auth/billing schema. All construction domain data
// (BOQ, progress, site diary, budgets, etc.) lives in VERIDIAN -- see
// src/lib/veridian-client.ts. Nothing construction-related is stored here.

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
