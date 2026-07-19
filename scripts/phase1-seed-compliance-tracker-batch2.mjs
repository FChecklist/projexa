// PROJEXA E2E Testing Program -- Phase 1 -- seed batch 2/4 (RFIs / submittals
// / punch-list / change orders / site diary / schedule tasks). AS-RUN RECORD
// (see batch 1's header comment). Requires batch1-context.json from batch 1.
import pg from "pg";
import fs from "fs";

try {
  const envLocal = fs.readFileSync("/opt/veridian/repos/compliance-tracker/.env.local", "utf8");
  for (const line of envLocal.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch { /* fall through to process.env.DATABASE_URL */ }
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const ctx = JSON.parse(fs.readFileSync("/tmp/seed-runner/batch1-context.json", "utf8"));
const { orgId, userIds, projectIds } = ctx;
const startDateByPrefix = { MHA: "2026-01-15", EBP: "2025-11-01", RPS: "2026-03-01", HLW: "2025-09-01" };
for (const pr of projectIds) pr.start = startDateByPrefix[pr.prefix];
const CEO = userIds["Arjun"], PM = userIds["Rohan"], SITE_ENG = userIds["Vikram"], SITE_SUP = userIds["Manoj"],
  QS = userIds["Priya"], PROC_MGR = userIds["Ananya"], SAFETY = userIds["Karan"], HR_ADMIN = userIds["Sneha"],
  FIN_MGR = userIds["Deepak"], DESIGN_LEAD = userIds["Kavita"], DOC_CTRL = userIds["Aditya"];

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
async function raw(sql, params = []) { return client.query(sql, params); }
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function addDays(baseIso, days) {
  const dt = new Date(baseIso + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function pick(arr) { return arr[rnd(0, arr.length - 1)]; }

const fieldStaff = [SITE_ENG, SITE_SUP, QS, SAFETY];
const rfiSubjects = [
  "Clarification on beam-column junction reinforcement detail",
  "Waterproofing specification for podium slab",
  "Discrepancy between architectural and structural drawings - Grid C4",
  "Confirmation of finish level for lobby flooring",
  "Query on fire-rated door specification at staircase 2",
  "Clarification on expansion joint detailing",
  "Approval needed for alternate tile brand (cost parity)",
  "Query on HVAC duct routing clash with structural beam",
  "Clarification on external facade glazing U-value requirement",
  "Confirmation of rebar cover for foundation raft",
];
const submittalTitles = [
  "Shop drawing - Precast staircase unit",
  "Product data - Waterproofing membrane",
  "Sample - Vitrified floor tile (living room grade)",
  "Shop drawing - Structural steel connection detail",
  "Product data - Fire-rated glazing system",
  "Sample - Exterior paint finish (3 shades)",
  "Shop drawing - MEP coordinated ceiling layout",
  "Product data - Elevator specification (8-passenger)",
];
const punchDescriptions = [
  "Paint touch-up required in unit 402 living room",
  "Door handle misaligned - staircase 1, level 3",
  "Grout gap in bathroom tile - unit 210",
  "Ceiling light fixture not flush - lobby",
  "Window seal leaking - unit 508",
  "Skirting not installed - corridor level 5",
  "Switch board cover missing - unit 305",
  "Uneven flooring near entrance ramp",
  "Cracked tile - basement parking level 1",
  "Handrail loose - fire exit staircase",
];
const changeOrderTitles = [
  "Additional waterproofing at basement due to high water table",
  "Upgrade to premium elevator specification per client request",
  "Structural revision at Grid C4 due to soil report update",
];
const weatherOptions = ["Clear", "Partly cloudy", "Heavy rain", "Overcast", "Humid, no rain"];

const taskTypeRes0 = await raw(`select id from compliance.pms_issue_types where org_id=$1 and name='Task'`, [orgId]);
const taskTypeId = taskTypeRes0.rows[0].id;

for (const pr of projectIds) {
  const statusIds = pr.statusIds;

  // RFIs (~8 per project)
  for (let n = 1; n <= 8; n++) {
    const status = n <= 5 ? "answered" : n <= 7 ? "open" : "closed";
    const raisedBy = pick(fieldStaff);
    await ins(
      "construction_rfis",
      ["org_id", "project_id", "number", "subject", "question", "status", "ball_in_court", "raised_by_id", "assigned_to_id", "due_date", "answer", "answered_by_id", "answered_at"],
      [orgId, pr.id, n, pick(rfiSubjects), `Please advise on: ${pick(rfiSubjects).toLowerCase()}. Field team requires clarification before proceeding.`,
        status, pick(["architect", "consultant", "owner"]), raisedBy, DESIGN_LEAD, addDays(pr.start, 10 + n * 5),
        status !== "open" ? "Confirmed per revised drawing rev C, proceed as per attached sketch." : null,
        status !== "open" ? DESIGN_LEAD : null, status !== "open" ? new Date().toISOString() : null]
    );
  }

  // Submittals (~6 per project)
  for (let n = 1; n <= 6; n++) {
    const status = n <= 3 ? "approved" : n === 4 ? "revise_resubmit" : n === 5 ? "pending" : "approved_as_noted";
    await ins(
      "construction_submittals",
      ["org_id", "project_id", "number", "title", "spec_section", "type", "status", "submitted_by_id", "due_date", "reviewed_by_id", "reviewed_at", "review_comments"],
      [orgId, pr.id, n, pick(submittalTitles), `Section 0${rnd(3, 9)} ${rnd(100, 999)}`, pick(["shop_drawing", "product_data", "sample"]),
        status, DOC_CTRL, addDays(pr.start, 15 + n * 4), status !== "pending" ? DESIGN_LEAD : null,
        status !== "pending" ? new Date().toISOString() : null, status !== "pending" ? "Reviewed against spec, comments attached." : null]
    );
  }

  // Punch-list (~10 per project)
  for (let n = 1; n <= 10; n++) {
    const status = n <= 6 ? "verified_closed" : n <= 8 ? "ready_for_review" : "open";
    await ins(
      "construction_punch_list_items",
      ["org_id", "project_id", "number", "description", "location", "trade", "priority", "status", "assigned_to_id", "due_date", "verified_by_id", "verified_at", "created_by_id"],
      [orgId, pr.id, n, pick(punchDescriptions), `Block ${pick(["A", "B", "C"])}, Level ${rnd(1, 12)}`, pick(["Civil", "Electrical", "Plumbing", "Painting", "Carpentry"]),
        pick(["low", "medium", "high"]), status, pick(fieldStaff), addDays(pr.start, 30 + n * 3),
        status === "verified_closed" ? SITE_SUP : null, status === "verified_closed" ? new Date().toISOString() : null, SITE_ENG]
    );
  }

  // Change orders (~3 per project)
  for (let n = 1; n <= 3; n++) {
    const status = n === 1 ? "approved" : n === 2 ? "pending_approval" : "draft";
    const costImpact = rnd(150000, 2500000);
    await ins(
      "construction_change_orders",
      ["org_id", "project_id", "number", "title", "description", "reason", "cost_impact", "schedule_impact_days", "status", "requested_by_id", "approved_by_id", "approved_at"],
      [orgId, pr.id, n, pick(changeOrderTitles), `Change order raised for ${pr.name}: ${pick(changeOrderTitles).toLowerCase()}.`,
        "Site condition / client request", costImpact, rnd(5, 25), status, PM, status === "approved" ? CEO : null, status === "approved" ? new Date().toISOString() : null]
    );
  }

  // Site diaries (~15 per project, consecutive days from start)
  for (let n = 0; n < 15; n++) {
    const diaryDate = addDays(pr.start, n);
    await ins(
      "construction_site_diaries",
      ["org_id", "project_id", "diary_date", "weather", "work_done", "visitors", "issues", "instructions", "material_received", "labour_count", "remarks", "recorded_by_id"],
      [orgId, pr.id, diaryDate, pick(weatherOptions), `Continued ${pick(["shuttering work", "reinforcement fixing", "concreting", "masonry", "MEP first fix", "flooring", "painting"])} on ${pick(["Block A", "Block B", "podium level", "3rd floor", "basement"])}.`,
        n % 4 === 0 ? "Client site visit - QA review" : null, n % 5 === 0 ? "Minor delay due to material delivery" : null,
        "Continue as per schedule, ensure safety briefing before shift", n % 3 === 0 ? `Cement (${rnd(100, 400)} bags), Steel (${rnd(2, 10)} MT)` : null,
        rnd(25, 120), n % 6 === 0 ? "All safety protocols followed" : null, SITE_SUP]
    );
  }

  // Schedule tasks (pms_issues, ~15 per project) + a few dependencies
  const issueIds = [];
  const taskNames = [
    "Site mobilization & fencing", "Excavation & shoring", "Foundation RCC work", "Basement structure",
    "Superstructure - Level 1-5", "Superstructure - Level 6-10", "Masonry & blockwork", "MEP first fix",
    "Plastering & waterproofing", "Flooring works", "MEP second fix & testing", "Facade & glazing",
    "Painting & finishing", "Elevator installation", "Final handover & snagging",
  ];
  for (let n = 0; n < taskNames.length; n++) {
    const statusGroup = n < 6 ? "completed" : n < 9 ? "started" : n < 12 ? "unstarted" : "backlog";
    const startD = addDays(pr.start, n * 20);
    const dueD = addDays(pr.start, n * 20 + 18);
    const issueId = await ins(
      "pms_issues",
      ["org_id", "project_id", "type_id", "status_id", "priority", "number", "title", "description", "assignee_id", "start_date", "due_date", "completion_percentage"],
      [orgId, pr.id, taskTypeId, statusIds[statusGroup], pick(["high", "medium", "urgent"]), n + 1, taskNames[n],
        `${taskNames[n]} for ${pr.name}.`, pick(fieldStaff), startD, dueD, statusGroup === "completed" ? 100 : statusGroup === "started" ? rnd(20, 80) : 0]
    );
    issueIds.push(issueId);
  }

  // sequential "blocks" dependencies between consecutive tasks
  for (let n = 0; n < issueIds.length - 1; n++) {
    await ins(
      "pms_issue_relations",
      ["org_id", "issue_id", "related_issue_id", "relation_type", "lag_days"],
      [orgId, issueIds[n], issueIds[n + 1], "blocks", 2]
    );
  }
  await raw(`update compliance.projects set issue_sequence=$1 where id=$2`, [taskNames.length, pr.id]);
}

console.log("=== batch 2 (RFIs/submittals/punch-list/change-orders/site-diary/schedule) complete ===");
console.log(JSON.stringify(counts, null, 2));

await client.end();
