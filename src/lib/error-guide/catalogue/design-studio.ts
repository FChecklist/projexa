// Design Studio: designer timesheets, day review/submit, cost analysis, mood boards, floor plans, FF&E.
// Server messages: PROJEXA api/review-day, api/submit-day, api/timesheets, api/floor-plans, api/ffe.
import { ent, guides, here, proj, rx } from "./_helpers";

const BACK = "Back to Design Studio";
const ds = proj("/design-studio");

export const designStudioGuides = guides([
  {
    id: "design-timesheet-fields", source: "validation", match: { status: 400, messageRegex: rx("projectId and spentOn are required|designerId, projectId, spentOn and decision are required") },
    title: "Choose the project, day and designer",
    what: "{serverMessage}",
    why: "A timesheet day is tied to one project, one day and one designer.",
    steps: ["Pick the project.", "Choose the day.", "Pick the designer (and Approve or Reject when reviewing).", "Try again."],
    fix: { label: "Open the timesheet", to: proj("/design-studio/timesheets/new"), where: "Design Studio > Timesheets > New" },
    severity: "warn", returnLabel: BACK,
  },
  {
    id: "design-timesheet-hours", source: "validation", match: { code: "HOURS_RANGE", field: "hours" },
    title: "Hours must be between 0 and 24",
    what: "The hours you typed are below 0 or above 24 for one day.",
    why: "A person cannot work more than 24 hours in a day.",
    steps: ["Type hours between 0 and 24, like 6.5.", "Save again."],
    fix: { label: "Fix the hours", to: proj("/design-studio/timesheets/new"), where: "Design Studio > Timesheet > Hours" },
    severity: "warn", returnLabel: BACK,
  },
  {
    id: "design-submit-empty", source: "prerequisite", match: { code: "EMPTY_DAY" },
    title: "No time logged for this day",
    what: "No hours are logged for this day.",
    why: "A day can be submitted only when it has time entries.",
    steps: ["Add your hours for the day.", "Then press Submit day."],
    fix: { label: "Add time", to: proj("/design-studio/timesheets/new"), where: "Design Studio > Timesheet > New" },
    severity: "warn", returnLabel: BACK,
  },
  {
    id: "design-review-self", source: "permission", match: { code: "SELF_REVIEW" },
    title: "You cannot review your own day",
    what: "A manager or another reviewer must approve your timesheet.",
    why: "A second person checks time so it is trusted.",
    steps: ["Ask your manager to open Review.", "They approve or reject your day."],
    fix: { label: "Open Review", to: proj("/design-studio/review"), where: "Design Studio > Review" },
    severity: "block", returnLabel: BACK,
  },
  {
    id: "design-review-locked", source: "conflict", match: { code: "DAY_LOCKED" },
    title: "This day is already approved",
    what: "Approved days are locked and cannot be changed.",
    why: "Approved time may already be in costs and pay.",
    steps: ["Ask the reviewer to reject the day so it opens again.", "Fix the hours.", "Submit again."],
    fix: { label: "Open Review", to: proj("/design-studio/review"), where: "Design Studio > Review" },
    severity: "block", returnLabel: BACK,
  },
  {
    id: "design-timesheet-missing", source: "server", match: { status: 404, apiPath: "/timesheets" },
    title: "That timesheet cannot be found",
    what: "The timesheet was removed or belongs to another company.",
    why: "It may have been deleted by someone else.",
    steps: ["Open the timesheet list.", "Find the right day."],
    fix: { label: "Open Design Studio", to: ds, where: "Design Studio > Timesheets" },
    severity: "warn", returnLabel: BACK,
  },
  {
    id: "design-cost-no-rate", source: "prerequisite", match: { code: "NO_RATE" },
    title: "A designer has no rate set",
    what: "Cost analysis needs an hourly rate for each designer, and one is missing.",
    why: "Cost is hours multiplied by rate.",
    steps: ["Open the employee.", "Add their rate.", "Run the analysis again."],
    fix: { label: "Open employees", to: "/employees", where: "Employees > this person > Rate" },
    severity: "warn", returnLabel: BACK,
  },
  {
    id: "design-floorplan-file", source: "upload", match: { code: "FLOORPLAN_FILE", apiPath: "/floor-plans" },
    title: "The floor plan file could not be read",
    what: "The floor plan is damaged or in a type we cannot open.",
    why: "Only drawings and images of the supported types can be shown.",
    steps: ["Export the plan as PDF or image.", "Upload it again."],
    fix: { label: "Open Floor Plans", to: proj("/floor-plans"), where: "Floor Plans" },
    severity: "warn", returnLabel: BACK,
  },
  {
    id: "design-load-failed", source: "server", match: { status: [500, 502, 503], method: "GET", apiPath: "/design" },
    title: "Design Studio did not load",
    what: "The Design Studio data could not be read.",
    why: "A temporary problem. Your data is safe.",
    steps: ["Press Try again.", "If it fails again, check your internet."],
    retry: true, severity: "warn", returnLabel: BACK,
    fix: { label: "Reload", to: here, where: "This screen" },
  },
  {
    id: "design-item-open", source: "validation", match: { code: "DS_ITEM_REQUIRED", apiPath: "/mood-boards" },
    title: "Add something to the board first",
    what: "A mood board needs at least one item.",
    why: "An empty board has nothing to show.",
    steps: ["Add an image or note.", "Save again."],
    fix: { label: "Open the board", to: ent("/mood-boards"), where: "Mood Boards > this board > Add item" },
    severity: "warn", returnLabel: BACK,
  },
]);
