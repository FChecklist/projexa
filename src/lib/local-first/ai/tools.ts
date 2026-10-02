// LOCAL-FIRST browser AI: the ONE list of tools a browser AI is offered, with JSON schemas. webmcp.ts registers exactly
// these with navigator.modelContext; manual.ts prints exactly these; api.ts implements exactly these. Keeping the list
// in one place is what lets immutability.test.ts enumerate everything the AI can reach.
//
// PURE.

import type { WriteAction } from "./registry";

export type ToolName = "projexa_manifest" | "projexa_list" | "projexa_get" | "projexa_search" | "projexa_create" | "projexa_update" | "projexa_delete" | "projexa_manual";

export type ToolSpec = {
  name: ToolName;
  /** The window.projexa.ai method the tool calls. */
  method: "manifest" | "list" | "get" | "search" | "create" | "update" | "delete" | "manual";
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  action?: WriteAction;
};

const str = (description: string) => ({ type: "string", description });
const recordRef = { type: "object", description: "The record to change: its kind and id, exactly as list()/get() return them.", properties: { kind: str("Record kind, e.g. \"tasks\""), id: str("Record id") }, required: ["kind", "id"], additionalProperties: false };
const writeProps = (verb: string) => ({
  functionId: str(`Id of the ${verb} function (manifest().functions.${verb}[].id)`),
  params: { type: "object", description: "The function's named values (manifest() lists each function's params; projectId is always one).", additionalProperties: true },
});

export const TOOLS: readonly ToolSpec[] = Object.freeze([
  {
    name: "projexa_manifest", method: "manifest", readOnly: true,
    title: "Who am I working for",
    description: "The signed-in person, their role and organisation, their projects, the record kinds on this laptop, and the create/update/delete functions their role may use.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "projexa_list", method: "list", readOnly: true,
    title: "List records",
    description: "Records of one kind from this laptop's copy (works offline). Optional project, exact-match filter on fields, and limit (default 50, max 500).",
    inputSchema: {
      type: "object",
      properties: { kind: str("Record kind, e.g. \"tasks\", \"rfis\", \"boq_lines\""), projectId: str("Only this project"), filter: { type: "object", description: "Field -> exact value", additionalProperties: true }, limit: { type: "integer", minimum: 1, maximum: 500 } },
      required: ["kind"], additionalProperties: false,
    },
  },
  {
    name: "projexa_get", method: "get", readOnly: true,
    title: "Get one record",
    description: "One record by kind and id from this laptop's copy.",
    inputSchema: { type: "object", properties: { kind: str("Record kind"), id: str("Record id") }, required: ["kind", "id"], additionalProperties: false },
  },
  {
    name: "projexa_search", method: "search", readOnly: true,
    title: "Search",
    description: "Case-insensitive text search across every record on this laptop (optionally one project). At most 50 results.",
    inputSchema: { type: "object", properties: { text: str("Words to find"), projectId: str("Only this project") }, required: ["text"], additionalProperties: false },
  },
  {
    name: "projexa_create", method: "create", readOnly: false, action: "create",
    title: "Create a record",
    description: "Proposes a new record with a create function the person's role may use. Saved on this laptop at once and synced later (works offline). The server re-checks it.",
    inputSchema: { type: "object", properties: writeProps("create"), required: ["functionId", "params"], additionalProperties: false },
  },
  {
    name: "projexa_update", method: "update", readOnly: false, action: "update",
    title: "Change a record",
    description: "Proposes a change to a record this laptop holds, with an update function the person's role may use. Saved at once, synced later.",
    inputSchema: { type: "object", properties: { ...writeProps("update"), record: recordRef }, required: ["functionId", "record", "params"], additionalProperties: false },
  },
  {
    name: "projexa_delete", method: "delete", readOnly: false, action: "delete",
    title: "Remove a record",
    description: "Asks to remove (void) a record. Unless the person turned on \"let my AI act without asking\", this only makes a DRAFT the person confirms with one click in PROJEXA.",
    inputSchema: { type: "object", properties: { ...writeProps("delete"), record: recordRef }, required: ["functionId", "record", "params"], additionalProperties: false },
  },
  {
    name: "projexa_manual", method: "manual", readOnly: true,
    title: "Read the manual",
    description: "The machine-readable manual for this person: what the AI may read and do, every function with its parameters, the role rules, and that the software itself cannot be changed.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] satisfies ToolSpec[]);
