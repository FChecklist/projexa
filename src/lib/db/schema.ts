import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";

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
    userId: uuid("user_id").notNull(),
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
