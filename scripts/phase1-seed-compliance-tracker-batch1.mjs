// PROJEXA E2E Testing Program -- Phase 1 -- seed batch 1/4 (org / users /
// projects / PMS taxonomy / BOQ). AS-RUN RECORD: this already executed
// successfully against compliance-tracker's live DB on 2026-07-19 (see
// PHASE1_SEED_REPORT.md for the resulting org id and exact row counts).
// Kept here for reproducibility -- e.g. if a similar test org needs
// re-seeding for a later phase. Writes batch1-context.json, which batches
// 2-4 read to resolve org/user/project ids.
import pg from "pg";
import fs from "fs";

// Load DATABASE_URL from compliance-tracker's .env.local if present (same
// convention as src/db/seed.ts: raw postgres role, table owner, bypasses RLS
// by ownership); otherwise expects DATABASE_URL already set in the environment.
try {
  const envLocal = fs.readFileSync("/opt/veridian/repos/compliance-tracker/.env.local", "utf8");
  for (const line of envLocal.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch { /* fall through to process.env.DATABASE_URL */ }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const counts = {};
function bump(key, n = 1) { counts[key] = (counts[key] || 0) + n; }

async function ins(table, cols, values) {
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const sql = `insert into compliance.${table} (${colList}) values (${placeholders}) returning id`;
  const res = await client.query(sql, values);
  bump(table);
  return res.rows[0].id;
}
async function insMany(table, cols, rows) {
  const ids = [];
  for (const values of rows) ids.push(await ins(table, cols, values));
  return ids;
}
async function raw(sql, params = []) {
  return client.query(sql, params);
}

function d(dateStr) { return dateStr; } // date columns are 'YYYY-MM-DD' strings
function pick(arr, i) { return arr[i % arr.length]; }
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function addDays(baseIso, days) {
  const dt = new Date(baseIso + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

console.log("=== Phase 1 seed: Meridian Construction Group (E2E Test Org) ===");

// ---------------------------------------------------------------------------
// 0. Guard: refuse to run twice against the same org name.
// ---------------------------------------------------------------------------
const existing = await raw(`select id from compliance.organisations where slug = $1`, ["meridian-construction-e2e-test"]);
if (existing.rows.length) {
  console.error("Org already exists:", existing.rows[0].id, "-- aborting to avoid duplicate seed.");
  await client.end();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Organisation + product-branch enablements
// ---------------------------------------------------------------------------
const projexaBranch = await raw(`select id from platform.product_branches where branch_key = 'projexa'`);
const projexaBranchId = projexaBranch.rows[0].id;

const orgId = await ins(
  "organisations",
  ["name", "slug", "plan", "account_type", "country", "primary_product_branch_id"],
  ["Meridian Construction Group (E2E Test Org)", "meridian-construction-e2e-test", "pro", "company", "IN", projexaBranchId]
);
console.log("orgId:", orgId);

const branchKeys = ["construction", "pms", "erp", "sales", "hr", "veri_reward", "veri_chat_v2"];
const branchRows = await raw(`select id, branch_key from platform.product_branches where branch_key = any($1)`, [branchKeys]);
for (const row of branchRows.rows) {
  await ins(
    "org_product_branch_enablements",
    ["org_id", "product_branch_id", "is_enabled", "enabled_at"],
    [orgId, row.id, true, new Date().toISOString()]
  );
}
console.log("branch enablements:", branchRows.rows.map((r) => r.branch_key).join(", "));

// ---------------------------------------------------------------------------
// 2. Departments
// ---------------------------------------------------------------------------
const deptDefs = [
  ["General", "Executive & shared services"],
  ["Site Operations", "Field execution: engineering, supervision, safety"],
  ["Procurement", "Vendor sourcing, purchase orders, materials"],
  ["Finance & Accounts", "Billing, payroll, statutory compliance"],
  ["HR", "Recruitment, employee records, leave"],
  ["Design & Engineering", "Drawings, BOQ, document control"],
];
const deptIds = {};
for (const [name, description] of deptDefs) {
  deptIds[name] = await ins("departments", ["name", "description", "org_id"], [name, description, orgId]);
}
console.log("departments:", Object.keys(deptIds).join(", "));

// ---------------------------------------------------------------------------
// 3. Users (CEO + 10) + employee profiles
// ---------------------------------------------------------------------------
const EMAIL_DOMAIN = "meridian-construction.e2e-test.projexa-ai.com";
const PLACEHOLDER_HASH = "supabase-auth-managed"; // matches schema.ts:233's documented convention

const peopleDefs = [
  { first: "Arjun", last: "Mehta", role: "admin", title: "Chief Executive Officer", dept: "General", reportsTo: null, empType: "full_time", doj: "2019-04-01" },
  { first: "Rohan", last: "Kapoor", role: "manager", title: "Project Manager", dept: "Site Operations", reportsTo: "Arjun", empType: "full_time", doj: "2020-02-15" },
  { first: "Vikram", last: "Singh", role: "member", title: "Site Engineer", dept: "Site Operations", reportsTo: "Rohan", empType: "full_time", doj: "2021-06-01" },
  { first: "Manoj", last: "Yadav", role: "member", title: "Site Supervisor", dept: "Site Operations", reportsTo: "Rohan", empType: "full_time", doj: "2021-08-10" },
  { first: "Priya", last: "Nair", role: "senior_professional", title: "Quantity Surveyor", dept: "Site Operations", reportsTo: "Arjun", empType: "full_time", doj: "2020-11-20" },
  { first: "Ananya", last: "Rao", role: "manager", title: "Procurement Manager", dept: "Procurement", reportsTo: "Arjun", empType: "full_time", doj: "2020-05-05" },
  { first: "Karan", last: "Malhotra", role: "member", title: "Safety Officer (EHS)", dept: "Site Operations", reportsTo: "Arjun", empType: "full_time", doj: "2022-01-10" },
  { first: "Sneha", last: "Reddy", role: "manager", title: "HR Administrator", dept: "HR", reportsTo: "Arjun", empType: "full_time", doj: "2019-09-01" },
  { first: "Deepak", last: "Joshi", role: "manager", title: "Finance & Accounts Manager", dept: "Finance & Accounts", reportsTo: "Arjun", empType: "full_time", doj: "2019-07-15" },
  { first: "Kavita", last: "Iyer", role: "senior_professional", title: "Design Lead / Architect", dept: "Design & Engineering", reportsTo: "Arjun", empType: "full_time", doj: "2020-03-01" },
  { first: "Aditya", last: "Verma", role: "team_member", title: "Document Controller", dept: "Design & Engineering", reportsTo: "Kavita", empType: "full_time", doj: "2022-04-18" },
];

const userIds = {}; // first name -> user id
const employeeProfileIds = {}; // first name -> employee_profiles id
let empCodeSeq = 1;
for (const p of peopleDefs) {
  const email = `${p.first.toLowerCase()}.${p.last.toLowerCase()}@${EMAIL_DOMAIN}`;
  const uid = await ins(
    "users",
    ["name", "email", "password_hash", "role", "org_id", "department_id", "onboarding_completed", "onboarding_stage"],
    [`${p.first} ${p.last}`, email, PLACEHOLDER_HASH, p.role, orgId, deptIds[p.dept], true, "profile"]
  );
  userIds[p.first] = uid;
  const empCode = `MCG-${String(empCodeSeq++).padStart(3, "0")}`;
  const epId = await ins(
    "employee_profiles",
    ["user_id", "org_id", "employee_code", "job_title", "employment_type", "date_of_joining", "employment_status"],
    [uid, orgId, empCode, p.title, p.empType, p.doj, "active"]
  );
  employeeProfileIds[p.first] = epId;
}
// second pass: reportingToId self-FK + department heads
for (const p of peopleDefs) {
  if (p.reportsTo) {
    await raw(`update compliance.users set reporting_to_id = $1 where id = $2`, [userIds[p.reportsTo], userIds[p.first]]);
  }
}
const deptHeads = { General: "Arjun", "Site Operations": "Rohan", Procurement: "Ananya", "Finance & Accounts": "Deepak", HR: "Sneha", "Design & Engineering": "Kavita" };
for (const [dept, headFirst] of Object.entries(deptHeads)) {
  await raw(`update compliance.departments set head_id = $1 where id = $2`, [userIds[headFirst], deptIds[dept]]);
}
console.log("users:", Object.keys(userIds).length);

const CEO = userIds["Arjun"];
const PM = userIds["Rohan"];
const SITE_ENG = userIds["Vikram"];
const SITE_SUP = userIds["Manoj"];
const QS = userIds["Priya"];
const PROC_MGR = userIds["Ananya"];
const SAFETY = userIds["Karan"];
const HR_ADMIN = userIds["Sneha"];
const FIN_MGR = userIds["Deepak"];
const DESIGN_LEAD = userIds["Kavita"];
const DOC_CTRL = userIds["Aditya"];

// ---------------------------------------------------------------------------
// 4. Product + Projects
// ---------------------------------------------------------------------------
const productId = await ins("products", ["org_id", "name", "slug", "description"], [orgId, "Construction", "construction", "Core construction delivery product line"]);

const projectDefs = [
  { name: "Meridian Heights - Residential Tower A", desc: "28-storey residential tower, 220 units, Sector 62 Gurugram.", prefix: "MHA", start: "2026-01-15", target: "2027-06-30", health: "on_track", lead: PM },
  { name: "Emerald Business Park - Phase 1", desc: "480,000 sq ft Grade-A office campus, 3 towers, Phase 1 (Tower 1 + podium).", prefix: "EBP", start: "2025-11-01", target: "2026-12-15", health: "at_risk", lead: PM },
  { name: "Riverside Public School Renovation", desc: "Structural retrofit + new science block for a 1,200-student public school.", prefix: "RPS", start: "2026-03-01", target: "2026-11-30", health: "on_track", lead: SITE_ENG },
  { name: "Highway Logistics Warehouse Complex", desc: "3 pre-engineered steel warehouses (total 650,000 sq ft) off NH-48.", prefix: "HLW", start: "2025-09-01", target: "2026-08-31", health: "off_track", lead: SITE_SUP },
];
const projectIds = [];
for (const pr of projectDefs) {
  const pid = await ins(
    "projects",
    ["product_id", "org_id", "name", "description", "issue_prefix", "issue_sequence", "lead_user_id", "start_date", "target_date", "health_status"],
    [productId, orgId, pr.name, pr.desc, pr.prefix, 0, pr.lead, pr.start, pr.target, pr.health]
  );
  projectIds.push({ id: pid, ...pr });
}
console.log("projects:", projectIds.map((p) => p.name).join(" | "));

// ---------------------------------------------------------------------------
// 5. PMS issue types (org-wide) + issue statuses (per project)
// ---------------------------------------------------------------------------
const issueTypeDefs = [
  ["Task", false, true],
  ["Bug", false, false],
  ["Story", false, false],
  ["Epic", true, false],
];
const issueTypeIds = {};
for (const [name, isEpic, isDefault] of issueTypeDefs) {
  issueTypeIds[name] = await ins("pms_issue_types", ["org_id", "name", "is_epic", "is_default"], [orgId, name, isEpic, isDefault]);
}

const statusDefs = [
  ["Backlog", "backlog", 0, true],
  ["Todo", "unstarted", 1, false],
  ["In Progress", "started", 2, false],
  ["Done", "completed", 3, false],
  ["Cancelled", "cancelled", 4, false],
];
for (const pr of projectIds) {
  pr.statusIds = {};
  for (const [name, group, position, isDefault] of statusDefs) {
    pr.statusIds[group] = await ins(
      "pms_issue_statuses",
      ["org_id", "project_id", "name", "group", "position", "is_default"],
      [orgId, pr.id, name, group, position, isDefault]
    );
  }
}
console.log("pms issue types + per-project statuses seeded");

// ---------------------------------------------------------------------------
// 6. Construction categories + activities per project
// ---------------------------------------------------------------------------
const categoryTemplates = ["Civil & Structural", "MEP (Mechanical/Electrical/Plumbing)", "Finishing & Interiors"];
const activityTemplates = {
  "Civil & Structural": [["Excavation", "cum", 4200], ["RCC Footing & Columns", "cum", 1850], ["Slab Casting", "sqm", 9600], ["Masonry Work", "sqm", 7200]],
  "MEP (Mechanical/Electrical/Plumbing)": [["Electrical Conduiting", "rm", 12000], ["Plumbing Rough-in", "rm", 8400], ["HVAC Ducting", "rm", 3200], ["Fire Fighting Piping", "rm", 4100]],
  "Finishing & Interiors": [["Plastering", "sqm", 11000], ["Flooring - Vitrified Tiles", "sqm", 8800], ["Painting", "sqm", 15200], ["False Ceiling", "sqm", 6400]],
};
for (const pr of projectIds) {
  pr.categoryIds = {};
  pr.activityIds = [];
  for (const catName of categoryTemplates) {
    const catId = await ins("construction_categories", ["org_id", "project_id", "name"], [orgId, pr.id, catName]);
    pr.categoryIds[catName] = catId;
    for (const [actName, unit, qty] of activityTemplates[catName]) {
      const actId = await ins(
        "construction_activities",
        ["org_id", "project_id", "category_id", "name", "unit", "planned_quantity"],
        [orgId, pr.id, catId, actName, unit, qty]
      );
      pr.activityIds.push({ id: actId, name: actName, unit, categoryName: catName });
    }
  }
}
console.log("construction categories + activities seeded (3 categories x 4 activities x 4 projects)");

// ---------------------------------------------------------------------------
// 7. BOQ + line items per project
// ---------------------------------------------------------------------------
const boqStatusByProject = ["approved", "approved", "submitted", "draft"];
for (let i = 0; i < projectIds.length; i++) {
  const pr = projectIds[i];
  const boqId = await ins(
    "construction_boqs",
    ["org_id", "project_id", "version", "title", "status", "created_by_id", "approved_by_id", "approved_at"],
    [orgId, pr.id, 1, `${pr.prefix} - Bill of Quantities v1`, boqStatusByProject[i], QS,
      boqStatusByProject[i] === "approved" ? CEO : null, boqStatusByProject[i] === "approved" ? new Date().toISOString() : null]
  );
  pr.boqId = boqId;
  let lineNo = 1;
  for (const act of pr.activityIds) {
    const qty = rnd(50, 5000);
    const rate = rnd(150, 9500);
    const amount = qty * rate;
    await ins(
      "construction_boq_line_items",
      ["boq_id", "activity_id", "item_code", "description", "unit", "quantity", "rate", "amount", "material_cost", "labour_cost", "overhead_percent", "profit_percent"],
      [boqId, act.id, `${pr.prefix}-BOQ-${String(lineNo++).padStart(3, "0")}`, act.name, act.unit, qty, rate, amount, Math.round(amount * 0.55), Math.round(amount * 0.3), 8, 10]
    );
  }
}
console.log("BOQs + line items seeded (1 BOQ x ~12 line items x 4 projects)");

await client.end();
console.log("=== batch 1 (org/users/projects/pms-taxonomy/boq) complete ===");
console.log(JSON.stringify(counts, null, 2));
console.log("ORG_ID=" + orgId);
console.log("PRODUCT_ID=" + productId);
fs.writeFileSync("/tmp/seed-runner/batch1-context.json", JSON.stringify({
  orgId, productId, deptIds, userIds, employeeProfileIds,
  projectIds: projectIds.map((p) => ({ id: p.id, prefix: p.prefix, name: p.name, statusIds: p.statusIds, categoryIds: p.categoryIds, activityIds: p.activityIds, boqId: p.boqId })),
}, null, 2));
