// R67 F-18 -- ONE definition of each module list's fallback columns.
//
// WHY THIS FILE EXISTS. Every module list client carried its own private
// `COLUMNS` const: the hardcoded labels used when compliance.screen_definitions
// has no row for that screen yet (a 404, which is the normal state for most
// screens) or the lookup fails. That was fine while only the client needed
// them. D-04 needs them in a second place: each route's `loading.tsx` paints a
// table skeleton with THE SCREEN'S REAL COLUMN HEADS, before any data exists,
// so the frame the user sees while waiting is the frame they end up with --
// not a grey box that is replaced by a differently-shaped table.
//
// Two copies of a label list drift. So the clients now import their fallback
// from here, and the skeletons read the same arrays. A registry row still wins
// over these at runtime, exactly as before -- this changes where the fallback
// is written down, not which columns win.
//
// The keys are the screen_definitions function ids, so the fallback and the
// registry lookup are named the same thing.
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";

export const PERMITS_LIST_COLUMNS: ScreenColumn[] = [
  // R67 D-05 (lane D1, folded in here rather than in PermitsListClient so the
  // loading skeleton and the loaded table cannot disagree). ONE word set across
  // the list, the create form, the object page and the API. "Expiry date" here
  // against "End date" on the object page was the same field under two names on
  // two screens of one module, which is what D-05 exists to end.
  { label: "Permit number", field: "permitNumber", type: "text", importance: "High" },
  { label: "Permit name", field: "name", type: "text", importance: "High" },
  { label: "Issuing authority", field: "permitAuthority", type: "text", importance: "High" },
  { label: "Issue date", field: "issueDate", type: "date", importance: "High" },
  { label: "End date", field: "endDate", type: "date", importance: "High" },
  // R67 G-01: was "Days left", which promised a number. The cell now answers a
  // question ("Expires in 12 days", "Expired"), so the header asks one and the
  // type is text. Changed HERE rather than in PermitsListClient so the loading
  // skeleton and the loaded table cannot disagree about the last column.
  { label: "Status", field: "daysToExpiry", type: "text", importance: "High" },
];

export const MOMS_LIST_COLUMNS: ScreenColumn[] = [
  { label: "Meeting", field: "title", type: "text", importance: "High" },
  { label: "Date", field: "scheduledAt", type: "date", importance: "High" },
  { label: "Status", field: "status", type: "text", importance: "High" },
];

export const DRAWINGS_LIST_COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Kind", field: "kind", type: "text", importance: "High" },
  { label: "Discipline", field: "discipline", type: "text", importance: "High" },
  { label: "Added", field: "createdAt", type: "date", importance: "High" },
];

export const DOCUMENTS_LIST_COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Category", field: "category", type: "text", importance: "High" },
  { label: "Type", field: "fileType", type: "text", importance: "High" },
  { label: "Size", field: "fileSize", type: "number", importance: "High" },
  { label: "Expiry", field: "expiryDate", type: "date", importance: "High" },
  { label: "Added", field: "createdAt", type: "date", importance: "High" },
];

export const MANPOWER_LIST_COLUMNS: ScreenColumn[] = [
  { label: "ID", field: "employeeCode", type: "text", importance: "High" },
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Trade", field: "trade", type: "text", importance: "High" },
  { label: "Company", field: "vendorId", type: "text", importance: "High" },
  { label: "Daily Rate", field: "dailyRate", type: "number", importance: "High" },
  { label: "Status", field: "isActive", type: "text", importance: "High" },
];

export const MATERIAL_LIST_COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Spec", field: "spec", type: "text", importance: "Medium" },
  { label: "Unit", field: "unit", type: "text", importance: "High" },
  { label: "Unit Cost", field: "unitCost", type: "number", importance: "High" },
];

export const BOQ_LIST_COLUMNS: ScreenColumn[] = [
  { field: "title", label: "Title", type: "text", importance: "High" },
  { field: "version", label: "Version", type: "text", importance: "High" },
  { field: "status", label: "Status", type: "text", importance: "High" },
  // R67 F-29 (R-273): the compare summary rides on the list payload, so these
  // two are real columns now rather than a per-row /compare request.
  { field: "lineCount", label: "Lines", type: "number", importance: "Medium" },
  { field: "total", label: "Total", type: "number", importance: "High" },
  // R67 D-23 (R-176): the distance from the lineage's ORIGINAL is its own
  // column -- a chain of small revisions can still have moved the contract a
  // long way from where it started, which "vs. prior" alone never shows.
  { field: "variationVsOriginal", label: "Variation vs original", type: "text", importance: "High" },
  { field: "variation", label: "Variation vs. prior", type: "text", importance: "High" },
  { field: "createdAt", label: "Created", type: "date", importance: "High" },
];

export const WORK_PROGRESS_LIST_COLUMNS: ScreenColumn[] = [
  { label: "Date", field: "entryDate", type: "date", importance: "High" },
  { label: "Activity", field: "activityName", type: "text", importance: "High" },
  { label: "BOQ line", field: "boqLineDescription", type: "text", importance: "High" },
  { label: "Qty done", field: "quantityDone", type: "number", importance: "High" },
  { label: "% complete", field: "percentComplete", type: "number", importance: "High" },
  { label: "Basis", field: "entryBasis", type: "text", importance: "Medium" },
  { label: "Remarks", field: "remarks", type: "text", importance: "Low" },
];

export const SCHEDULE_TIMELINE_COLUMNS: ScreenColumn[] = [
  { field: "task", label: "Task", type: "text", importance: "High" },
  { field: "start", label: "Start", type: "date", importance: "High" },
  { field: "due", label: "Due", type: "date", importance: "High" },
  { field: "critical", label: "Critical Path", type: "text", importance: "High" },
  { field: "taskCount", label: "Tasks", type: "number", importance: "Medium" },
  { field: "criticalCount", label: "On Critical Path", type: "number", importance: "Medium" },
  { field: "milestoneCount", label: "Milestones", type: "number", importance: "Medium" },
];
