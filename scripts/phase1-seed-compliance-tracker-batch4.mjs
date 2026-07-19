// PROJEXA E2E Testing Program -- Phase 1 -- seed batch 4/4 (payroll / leave /
// documents / meetings / KPIs), plus minting the real vk_ VERIDIAN API key
// used to bridge a PROJEXA org to this compliance-tracker org (see
// scripts/phase1-provision-projexa-accounts.mjs). AS-RUN RECORD (see batch
// 1's header comment) -- running this again will mint a SECOND, different
// api_keys row; do not do that for the already-seeded org, reuse the one
// recorded in PHASE1_SEED_REPORT.md.
import pg from "pg";
import fs from "fs";
import crypto from "crypto";

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
const { orgId, userIds, employeeProfileIds, projectIds } = ctx;
const CEO = userIds["Arjun"], HR_ADMIN = userIds["Sneha"], FIN_MGR = userIds["Deepak"], DESIGN_LEAD = userIds["Kavita"];

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
function pick(arr) { return arr[rnd(0, arr.length - 1)]; }
function addDays(baseIso, days) {
  const dt = new Date(baseIso + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Payroll: salary components -> salary structures -> payroll runs -> payslips
// ---------------------------------------------------------------------------
const componentDefs = [
  ["Basic Pay", "earning", "percentage_of_gross", 50, null, false, true],
  ["HRA", "earning", "percentage_of_basic", 40, null, false, false],
  ["Special Allowance", "earning", "flat", null, null, false, false],
  ["Provident Fund", "deduction", "percentage_of_basic", 12, null, true, true],
  ["Professional Tax", "deduction", "flat", null, 200, true, false],
  ["TDS", "deduction", "flat", null, null, true, false],
];
const componentIds = {};
for (const [name, type, calcType, pct, amt, statutory, pfWage] of componentDefs) {
  componentIds[name] = await ins(
    "erp_salary_components",
    ["org_id", "name", "component_type", "calculation_type", "default_percentage", "default_amount", "is_statutory", "include_in_pf_wage"],
    [orgId, name, type, calcType, pct, amt, statutory, pfWage]
  );
}

const ctcByFirst = {
  Arjun: 4800000, Rohan: 2200000, Vikram: 1100000, Manoj: 850000, Priya: 1450000,
  Ananya: 1800000, Karan: 950000, Sneha: 1350000, Deepak: 1900000, Kavita: 1650000, Aditya: 700000,
};
const structureIdByFirst = {};
for (const [first, epId] of Object.entries(employeeProfileIds)) {
  const ctc = ctcByFirst[first] ?? 900000;
  const structId = await ins(
    "erp_salary_structures",
    ["org_id", "employee_id", "effective_from", "ctc_annual", "state", "created_by_id"],
    [orgId, epId, "2026-01-01", ctc, "Haryana", HR_ADMIN]
  );
  structureIdByFirst[first] = structId;
  const basic = Math.round(ctc * 0.5);
  const hra = Math.round(basic * 0.4);
  const special = ctc - basic - hra;
  await ins("erp_salary_structure_components", ["structure_id", "component_id", "amount"], [structId, componentIds["Basic Pay"], Math.round(basic / 12)]);
  await ins("erp_salary_structure_components", ["structure_id", "component_id", "amount"], [structId, componentIds["HRA"], Math.round(hra / 12)]);
  await ins("erp_salary_structure_components", ["structure_id", "component_id", "amount"], [structId, componentIds["Special Allowance"], Math.round(special / 12)]);
  await ins("erp_salary_structure_components", ["structure_id", "component_id", "amount"], [structId, componentIds["Provident Fund"], Math.round(basic * 0.12 / 12)]);
}
console.log("salary components + structures done");

const payrollMonths = [[4, 2026], [5, 2026], [6, 2026]];
for (const [month, year] of payrollMonths) {
  const runId = await ins(
    "erp_payroll_runs",
    ["org_id", "month", "year", "status", "processed_at", "created_by_id"],
    [orgId, month, year, month < 6 ? "paid" : "processed", month < 6 ? new Date().toISOString() : null, FIN_MGR]
  );
  for (const [first, epId] of Object.entries(employeeProfileIds)) {
    const ctc = ctcByFirst[first] ?? 900000;
    const basicM = Math.round(ctc * 0.5 / 12);
    const hraM = Math.round(basicM * 0.4);
    const specialM = Math.round(ctc / 12) - basicM - hraM;
    const pfM = Math.round(basicM * 0.12);
    const ptM = 200;
    const gross = basicM + hraM + specialM;
    const deductions = pfM + ptM;
    const net = gross - deductions;
    const payslipId = await ins(
      "erp_payslips",
      ["org_id", "payroll_run_id", "employee_id", "gross_earnings", "total_deductions", "net_pay", "status"],
      [orgId, runId, epId, gross, deductions, net, month < 6 ? "finalized" : "draft"]
    );
    await ins("erp_payslip_lines", ["payslip_id", "component_id", "label", "line_type", "amount"], [payslipId, componentIds["Basic Pay"], "Basic Pay", "earning", basicM]);
    await ins("erp_payslip_lines", ["payslip_id", "component_id", "label", "line_type", "amount"], [payslipId, componentIds["HRA"], "HRA", "earning", hraM]);
    await ins("erp_payslip_lines", ["payslip_id", "component_id", "label", "line_type", "amount"], [payslipId, componentIds["Special Allowance"], "Special Allowance", "earning", specialM]);
    await ins("erp_payslip_lines", ["payslip_id", "component_id", "label", "line_type", "amount"], [payslipId, componentIds["Provident Fund"], "Provident Fund", "deduction", pfM]);
    await ins("erp_payslip_lines", ["payslip_id", "component_id", "label", "line_type", "amount"], [payslipId, componentIds["Professional Tax"], "Professional Tax", "deduction", ptM]);
  }
}
console.log("payroll runs + payslips done (3 months x 11 employees)");

// ---------------------------------------------------------------------------
// Leave balances + requests
// ---------------------------------------------------------------------------
const leaveTypes = ["casual", "sick", "earned"];
for (const uid of Object.values(userIds)) {
  for (const lt of leaveTypes) {
    const total = lt === "earned" ? 15 : lt === "casual" ? 12 : 10;
    await ins("leave_balances", ["org_id", "user_id", "leave_type", "year", "total_days", "used_days"], [orgId, uid, lt, 2026, total, rnd(0, Math.floor(total / 2))]);
  }
}
const userList = Object.entries(userIds);
for (let i = 0; i < 15; i++) {
  const [first, uid] = pick(userList);
  const status = pick(["approved", "approved", "pending", "rejected"]);
  const start = addDays("2026-01-15", rnd(0, 150));
  const numDays = rnd(1, 4);
  await ins(
    "leave_requests",
    ["org_id", "user_id", "leave_type", "start_date", "end_date", "num_days", "reason", "status", "approver_id", "approved_at"],
    [orgId, uid, pick(leaveTypes), start, addDays(start, numDays - 1), numDays, pick(["Personal work", "Family function", "Medical", "Travel"]),
      status, status !== "pending" ? HR_ADMIN : null, status !== "pending" ? new Date().toISOString() : null]
  );
}
console.log("leave balances + requests done");

// ---------------------------------------------------------------------------
// Documents (generic, polymorphic) - ~25
// ---------------------------------------------------------------------------
const docCategories = ["contract", "permit", "drawing", "certificate", "site_photo", "other"];
for (let i = 0; i < 25; i++) {
  const pr = pick(projectIds);
  const category = pick(docCategories);
  await ins(
    "documents",
    ["name", "file_url", "file_type", "file_size", "uploaded_by_id", "org_id", "category", "linked_entity_type", "linked_entity_id"],
    [`${pr.prefix}-${category}-${i + 1}.pdf`, `https://storage.meridian-construction-e2e-test.internal/${orgId}/${category}/${i + 1}.pdf`,
      "application/pdf", rnd(80000, 4500000), DESIGN_LEAD, orgId, category, "project", pr.id]
  );
}
console.log("documents done: 25");

// ---------------------------------------------------------------------------
// Meetings (veri_meetings) - 12
// ---------------------------------------------------------------------------
const meetingTitles = [
  "Weekly site progress review", "Client coordination meeting", "Design coordination - MEP clash resolution",
  "Vendor negotiation - structural steel", "Safety committee review", "Monthly management review",
  "Subcontractor kickoff meeting", "Quality audit review", "Budget review meeting", "Schedule recovery planning",
  "Handover planning meeting", "Procurement strategy review",
];
for (let i = 0; i < 12; i++) {
  const pr = pick(projectIds);
  await ins(
    "veri_meetings",
    ["org_id", "context_entity_type", "context_entity_id", "title", "meeting_type", "scheduled_at", "attendees", "agenda", "minutes", "created_by_id", "status"],
    [orgId, "project", pr.id, `${meetingTitles[i]} - ${pr.prefix}`, pick(["team", "client", "vendor"]),
      new Date(new Date("2026-02-01").getTime() + i * 7 * 86400000).toISOString(),
      JSON.stringify(["Arjun Mehta", "Rohan Kapoor", "Priya Nair"]),
      JSON.stringify(["Progress review", "Open issues", "Action items"]),
      i % 2 === 0 ? "Discussed progress, agreed on action items for next week." : null,
      pick([CEO, HR_ADMIN, FIN_MGR]), i % 2 === 0 ? "published" : "draft"]
  );
}
console.log("meetings done: 12");

// ---------------------------------------------------------------------------
// KPIs (construction_kpi_definitions + entries)
// ---------------------------------------------------------------------------
const kpiDefs = [
  ["Schedule Performance Index", "ratio", "monthly"], ["Cost Performance Index", "ratio", "monthly"],
  ["Safety Incidents (LTI)", "count", "monthly"], ["Labour Productivity", "sqm/day", "monthly"],
  ["Material Wastage %", "percent", "monthly"], ["RFI Turnaround Time", "days", "monthly"],
];
for (const [metric, unit, period] of kpiDefs) {
  const defId = await ins(
    "construction_kpi_definitions",
    ["org_id", "project_id", "metric_name", "target_value", "unit", "period", "owner_id"],
    [orgId, null, metric, metric.includes("Index") ? 1.0 : metric.includes("Safety") ? 0 : rnd(5, 95), unit, period, CEO]
  );
  for (const monthLabel of ["2026-04", "2026-05", "2026-06"]) {
    await ins(
      "construction_kpi_entries",
      ["kpi_definition_id", "period", "actual_value", "filled_by_id", "approval_status", "approved_by_id", "approved_at"],
      [defId, monthLabel, metric.includes("Index") ? (0.85 + Math.random() * 0.3).toFixed(2) : rnd(0, 90), userIds["Priya"], "approved", CEO, new Date().toISOString()]
    );
  }
}
console.log("KPI definitions + entries done (6 x 3 months)");

// ---------------------------------------------------------------------------
// veridian_credentials bridge: mint a real vk_ apiKey for this org
// ---------------------------------------------------------------------------
function generateApiKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let random = "";
  for (let i = 0; i < 32; i++) random += chars.charAt(Math.floor(Math.random() * chars.length));
  return `vk_${random}`;
}
function hashSHA256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}
const projexaAppRes = await raw(`select id, display_name from compliance.platform_applications where application_key = 'projexa'`);
const projexaAppId = projexaAppRes.rows[0].id;
const rawKey = generateApiKey();
const keyHash = hashSHA256(rawKey);
const keyPrefix = rawKey.substring(0, 8) + "...";
const apiKeyId = await ins(
  "api_keys",
  ["name", "key_hash", "key_prefix", "org_id", "scopes", "is_active", "issued_for_application_id"],
  [`PROJEXA (Phase 1 E2E test org)`, keyHash, keyPrefix, orgId, "read,write", true, projexaAppId]
);
console.log("=== VERIDIAN API KEY MINTED (save this now, not retrievable again) ===");
console.log("apiKeyId:", apiKeyId);
console.log("rawKey:", rawKey);

fs.writeFileSync("/tmp/seed-runner/api-key-context.json", JSON.stringify({ apiKeyId, rawKey, orgId }, null, 2));

console.log("=== batch 4 (payroll/leave/documents/meetings/KPIs/apiKey) complete ===");
console.log(JSON.stringify(counts, null, 2));

await client.end();
