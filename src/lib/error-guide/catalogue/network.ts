// Transport and generic server failures: offline, timeout, busy, 429, 5xx, bad JSON, and the
// catch-all families (required / not found / failed to ...). These are the LEAST specific guides:
// the matcher should prefer any module guide above when both match.
import { guides, here, rx } from "./_helpers";

const BACK = "Back to what I was doing";

export const networkGuides = guides([
  {
    id: "net-data-service-slow", source: "network", match: { status: [408, 500, 503, 504], messageRegex: rx("did not respond in time|data service did not respond|Timed out waiting for the request body") },
    title: "The data service is slow",
    what: "{serverMessage}",
    why: "Many people may be using it at once. Your work is safe.",
    steps: ["Wait about 30 seconds.", "Press Try again."],
    retry: true, severity: "warn", returnLabel: BACK,
    fix: { label: "Stay on this screen", to: here, where: "This screen" },
  },
  {
    id: "net-failed-to", source: "server", match: { status: [500], messageRegex: rx("^(Failed to |Internal server error|Could not )") },
    title: "That did not work",
    what: "{serverMessage}",
    why: "An unexpected problem happened on our side. Nothing was changed.",
    steps: ["Press Try again.", "If it fails again, reload the page.", "Tell support the time and what you were doing."],
    retry: true, severity: "warn", returnLabel: BACK,
    fix: { label: "Reload this screen", to: here, where: "This screen" },
  },
  {
    id: "net-bad-json", source: "validation", match: { status: 400, messageRegex: rx("Body must be (a )?JSON|JSON body is required|must be valid JSON|Invalid (payload|request body)|Invalid token|Missing bearer token") },
    title: "The request was not understood",
    what: "{serverMessage}",
    why: "The page sent something unreadable. It usually fixes itself after a reload.",
    steps: ["Reload the page.", "Do the action again."],
    retry: true, severity: "warn", returnLabel: BACK,
    fix: { label: "Reload this screen", to: here, where: "This screen" },
  },
  {
    id: "net-required-generic", source: "validation", match: { status: 400, messageRegex: rx("(is|are) required\\.?$|required \\(") },
    title: "A needed box is empty",
    what: "{serverMessage}",
    why: "The form needs this to save.",
    steps: ["Find the box named in the message.", "Fill it in.", "Save again."],
    severity: "warn", returnLabel: BACK,
    fix: { label: "Back to the form", to: here, where: "This screen > the form" },
  },
  {
    id: "net-conflict-generic", source: "conflict", match: { status: 409 },
    title: "This clashes with something already there",
    what: "{serverMessage}",
    why: "The record changed, or the same item already exists.",
    steps: ["Reload the page.", "Look at the latest version.", "Repeat your change if still needed."],
    retry: true, severity: "warn", returnLabel: BACK,
    fix: { label: "Reload this screen", to: here, where: "This screen" },
  },
  {
    id: "net-too-large", source: "upload", match: { status: 413, messageRegex: rx("^Too large$") },
    title: "That is too much to send",
    what: "{serverMessage}",
    why: "The request is above the allowed size.",
    steps: ["Send less at once.", "Try again."],
    severity: "warn", returnLabel: BACK,
    fix: { label: "Stay on this screen", to: here, where: "This screen" },
  },
]);
