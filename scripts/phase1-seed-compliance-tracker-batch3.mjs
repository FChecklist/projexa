// PROJEXA E2E Testing Program -- Phase 1 -- seed batch 3/4 (vendors /
// materials / customers / purchase orders / quotations / sales orders /
// sales invoices). AS-RUN RECORD (see batch 1's header comment). Requires
// batch1-context.json from batch 1.
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
const CEO = userIds["Arjun"], PM = userIds["Rohan"], QS = userIds["Priya"], PROC_MGR = userIds["Ananya"], FIN_MGR = userIds["Deepak"];

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
// Vendors (erp_suppliers) - 10
// ---------------------------------------------------------------------------
const vendorDefs = [
  ["Shree Cement Traders", "material_supplier", "civil"],
  ["Bansal Steel Corporation", "material_supplier", "civil"],
  ["Precision Electricals Pvt Ltd", "subcontractor", "electrical"],
  ["AquaFlow Plumbing Solutions", "subcontractor", "plumbing"],
  ["Everest RMC Suppliers", "material_supplier", "civil"],
  ["Comfort Air HVAC Systems", "subcontractor", "hvac"],
  ["Modern Tiles & Ceramics", "material_supplier", "finishing"],
  ["SkyLift Elevators India", "subcontractor", "elevator"],
  ["Glasstech Facade Systems", "subcontractor", "facade"],
  ["Apex Scaffolding & Formwork", "equipment_rental", "civil"],
];
const vendorIds = [];
for (const [name, type, trade] of vendorDefs) {
  const id = await ins(
    "erp_suppliers",
    ["org_id", "supplier_name", "supplier_type", "gstin", "default_payment_terms_days", "credit_limit", "trade", "qualification_status"],
    [orgId, name, type, `29AAAA${rnd(1000, 9999)}A1Z${rnd(1, 9)}`, pick([30, 45, 60]), rnd(500000, 5000000), trade, "qualified"]
  );
  vendorIds.push({ id, name });
}
console.log("vendors:", vendorIds.length);

// ---------------------------------------------------------------------------
// Materials (erp_items) - 20
// ---------------------------------------------------------------------------
const itemDefs = [
  ["OPC 53 Grade Cement", "bag", 380], ["TMT Steel Bar 12mm", "kg", 68], ["TMT Steel Bar 16mm", "kg", 66],
  ["River Sand", "cum", 2200], ["20mm Aggregate", "cum", 1800], ["Ready Mix Concrete M25", "cum", 5600],
  ["Vitrified Tile 600x600", "sqm", 850], ["Ceramic Wall Tile", "sqm", 420], ["PVC Conduit Pipe 25mm", "rm", 35],
  ["Copper Electrical Wire 2.5sqmm", "rm", 42], ["CPVC Plumbing Pipe 1inch", "rm", 95], ["Exterior Emulsion Paint", "ltr", 320],
  ["Interior Emulsion Paint", "ltr", 280], ["Aluminium Window Frame", "sqm", 3200], ["Toughened Glass 12mm", "sqm", 1850],
  ["Fire Rated Door", "nos", 18500], ["False Ceiling Gypsum Board", "sqm", 260], ["Waterproofing Membrane", "sqm", 410],
  ["Structural Steel Section ISMB", "kg", 72], ["Precast Concrete Block", "nos", 55],
];
const itemIds = [];
let itemSeq = 1;
for (const [name, uom, rate] of itemDefs) {
  const id = await ins(
    "erp_items",
    ["org_id", "item_code", "item_name", "uom", "standard_selling_rate", "standard_buying_rate"],
    [orgId, `MAT-${String(itemSeq++).padStart(3, "0")}`, name, uom, Math.round(rate * 1.15), rate]
  );
  itemIds.push({ id, name, uom, rate });
}
console.log("materials:", itemIds.length);

// ---------------------------------------------------------------------------
// Customers (erp_customers) - 6
// ---------------------------------------------------------------------------
const customerDefs = [
  "Meridian Realty Developers Pvt Ltd", "Emerald Business Park Owners Association", "Riverside Municipal School Board",
  "Highway Logistics Infra Pvt Ltd", "Skyview Township Developers", "Prime Urban Housing Corporation",
];
const customerIds = [];
for (const name of customerDefs) {
  const id = await ins(
    "erp_customers",
    ["org_id", "customer_name", "gstin", "default_payment_terms_days", "credit_limit"],
    [orgId, name, `07BBBB${rnd(1000, 9999)}B1Z${rnd(1, 9)}`, pick([30, 45, 60]), rnd(2000000, 10000000)]
  );
  customerIds.push({ id, name });
}
console.log("customers:", customerIds.length);

// ---------------------------------------------------------------------------
// Purchase orders (12) + items
// ---------------------------------------------------------------------------
let poNumber = 1;
for (let i = 0; i < 12; i++) {
  const pr = projectIds[i % projectIds.length];
  const vendor = pick(vendorIds);
  const status = pick(["draft", "submitted", "partially_received", "completed", "completed"]);
  const orderDate = addDays(pr.start, 10 + i * 7);
  const poId = await ins(
    "erp_purchase_orders",
    ["org_id", "supplier_id", "po_number", "order_date", "expected_delivery_date", "status", "grand_total", "created_by_id"],
    [orgId, vendor.id, poNumber++, orderDate, addDays(orderDate, 14), status, 0, PROC_MGR]
  );
  let total = 0;
  const lineCount = rnd(2, 4);
  for (let l = 0; l < lineCount; l++) {
    const item = pick(itemIds);
    const qty = rnd(50, 800);
    const rate = item.rate;
    const amount = qty * rate;
    total += amount;
    await ins(
      "erp_purchase_order_items",
      ["purchase_order_id", "item_id", "description", "quantity", "rate", "amount", "received_quantity"],
      [poId, item.id, item.name, qty, rate, amount, status === "completed" ? qty : status === "partially_received" ? Math.floor(qty * 0.5) : 0]
    );
  }
  await raw(`update compliance.erp_purchase_orders set grand_total=$1 where id=$2`, [total, poId]);
}
console.log("purchase orders + items done");

// ---------------------------------------------------------------------------
// Quotations (8) + items
// ---------------------------------------------------------------------------
let quoteNumber = 1;
const quotationIds = [];
for (let i = 0; i < 8; i++) {
  const pr = projectIds[i % projectIds.length];
  const customer = pick(customerIds);
  const status = pick(["draft", "sent", "approved", "ordered", "lost"]);
  const quoteDate = addDays(pr.start, 5 + i * 10);
  const quoteId = await ins(
    "erp_quotations",
    ["org_id", "customer_id", "quotation_number", "quotation_date", "valid_till", "status", "grand_total", "created_by_id", "project_id"],
    [orgId, customer.id, quoteNumber++, quoteDate, addDays(quoteDate, 30), status, 0, QS, pr.id]
  );
  let total = 0;
  for (let l = 0; l < 3; l++) {
    const desc = `${pick(["Civil works", "MEP package", "Finishing works", "Structural works"])} - ${pr.prefix}`;
    const qty = rnd(1, 5);
    const rate = rnd(500000, 3500000);
    const amount = qty * rate;
    total += amount;
    await ins("erp_quotation_items", ["quotation_id", "description", "quantity", "rate", "amount"], [quoteId, desc, qty, rate, amount]);
  }
  await raw(`update compliance.erp_quotations set grand_total=$1 where id=$2`, [total, quoteId]);
  quotationIds.push({ id: quoteId, status, customerId: customer.id, projectId: pr.id });
}
console.log("quotations + items done");

// ---------------------------------------------------------------------------
// Sales orders (6) + items
// ---------------------------------------------------------------------------
let soNumber = 1;
const salesOrderIds = [];
const orderedQuotes = quotationIds.filter((q) => q.status === "ordered" || q.status === "approved");
for (let i = 0; i < 6; i++) {
  const pr = projectIds[i % projectIds.length];
  const src = orderedQuotes[i % Math.max(orderedQuotes.length, 1)];
  const customerId = src ? src.customerId : pick(customerIds).id;
  const status = pick(["confirmed", "partially_fulfilled", "fulfilled", "draft"]);
  const orderDate = addDays(pr.start, 20 + i * 12);
  const soId = await ins(
    "erp_sales_orders",
    ["org_id", "customer_id", "quotation_id", "so_number", "order_date", "delivery_date", "status", "grand_total", "created_by_id", "project_id"],
    [orgId, customerId, src ? src.id : null, soNumber++, orderDate, addDays(orderDate, 60), status, 0, FIN_MGR, pr.id]
  );
  let total = 0;
  for (let l = 0; l < 3; l++) {
    const desc = `${pick(["Milestone billing - foundation", "Milestone billing - superstructure", "Milestone billing - finishing", "Milestone billing - MEP"])}`;
    const qty = 1;
    const rate = rnd(800000, 4200000);
    const amount = qty * rate;
    total += amount;
    await ins("erp_sales_order_items", ["sales_order_id", "description", "quantity", "rate", "amount", "delivered_quantity"], [soId, desc, qty, rate, amount, status === "fulfilled" ? qty : 0]);
  }
  await raw(`update compliance.erp_sales_orders set grand_total=$1 where id=$2`, [total, soId]);
  salesOrderIds.push({ id: soId, customerId, projectId: pr.id });
}
console.log("sales orders + items done");

// ---------------------------------------------------------------------------
// Sales invoices (12) + items
// ---------------------------------------------------------------------------
let invoiceNumber = 1;
for (let i = 0; i < 12; i++) {
  const pr = projectIds[i % projectIds.length];
  const so = salesOrderIds[i % salesOrderIds.length];
  const status = pick(["draft", "submitted", "partially_paid", "paid", "overdue"]);
  const postingDate = addDays(pr.start, 40 + i * 15);
  let subtotal = 0;
  const lineDescs = [];
  for (let l = 0; l < 2; l++) {
    const rate = rnd(400000, 2200000);
    lineDescs.push(rate);
    subtotal += rate;
  }
  const taxAmount = Math.round(subtotal * 0.18);
  const grandTotal = subtotal + taxAmount;
  const outstanding = status === "paid" ? 0 : status === "partially_paid" ? Math.round(grandTotal * 0.4) : grandTotal;
  const invId = await ins(
    "erp_sales_invoices",
    ["org_id", "customer_id", "invoice_number", "posting_date", "due_date", "subtotal", "tax_amount", "grand_total", "outstanding_amount", "status", "sales_order_id", "created_by_id", "project_id"],
    [orgId, so.customerId, invoiceNumber++, postingDate, addDays(postingDate, 30), subtotal, taxAmount, grandTotal, outstanding, status, so.id, FIN_MGR, pr.id]
  );
  for (const rate of lineDescs) {
    await ins(
      "erp_sales_invoice_items",
      ["invoice_id", "description", "quantity", "rate", "amount", "hsn_sac_code"],
      [invId, "Construction services - RA bill", 1, rate, rate, "9954"]
    );
  }
}
console.log("sales invoices + items done");

console.log("=== batch 3 (vendors/materials/customers/PO/quotations/SO/invoices) complete ===");
console.log(JSON.stringify(counts, null, 2));

fs.writeFileSync("/tmp/seed-runner/batch3-context.json", JSON.stringify({ vendorIds, itemIds, customerIds }, null, 2));

await client.end();
