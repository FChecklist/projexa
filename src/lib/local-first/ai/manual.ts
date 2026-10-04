// LOCAL-FIRST browser AI: the MANUAL a browser AI reads to know what it may do in PROJEXA (requirements R5, R11).
//
//   buildManual()            the static manual: every function with the lowest role that may use it. No person, no
//                            data: it is what /ai-manual.json, /llms.txt and the in-page <script id="px-ai-manual"> serve.
//   buildManual({rank,role}) the person's own manual: ONLY the functions their role may use (window.projexa.ai.manual()).
//   manualText(manual)       the same in plain words (llms.txt format).
//
// Every form says, explicitly, that the SOFTWARE cannot be changed by any AI: there is no function for code, files,
// the service worker, the release bundle, the cache or the configuration, and the installed files are checked against
// their recorded fingerprints (integrity.ts).
//
// PURE: no browser global, no clock. Generated from registry.ts and tools.ts, never written twice by hand.

import { REGISTRY_SOURCE_COMMIT, actionOf, functionsForRank, rankWord, type RegistryFunction, type WriteAction } from "./registry";
import { TOOLS } from "./tools";

export const MANUAL_VERSION = 1;

export const SOFTWARE_STATEMENT =
  "No AI can change PROJEXA's software. This surface has no function that writes code, files, the service worker, the release bundle, the cache or the app configuration, and none that runs text as code. The installed app is checked against the fingerprints recorded when it was installed; if it was changed, AI access switches itself off. An AI works on the person's DATA only, as that person, with their role.";

/** Roles by rank (compliance-tracker role-rank.ts). */
export const ROLE_TABLE: readonly { rank: number; word: string; roles: string[] }[] = Object.freeze([
  { rank: 1, word: "viewer", roles: ["viewer", "client_viewer", "external_auditor", "stage_0"] },
  { rank: 2, word: "member", roles: ["member", "team_member"] },
  { rank: 3, word: "manager", roles: ["manager", "senior_professional"] },
  { rank: 4, word: "branch manager", roles: ["branch_manager"] },
  { rank: 5, word: "admin", roles: ["admin"] },
  { rank: 6, word: "platform admin", roles: ["veridian_admin"] },
]);

export type ManualFunction = {
  id: string;
  label: string;
  module: string;
  action: WriteAction;
  min_role: string;
  min_role_rank: number;
  money_sensitive: boolean;
  params: string[];
  required: { name: string; label: string; any_of: string[] }[];
};

export type Manual = {
  product: "PROJEXA";
  manual_version: number;
  registry_commit: string;
  surface: "window.projexa.ai";
  software_can_be_changed: false;
  software_statement: string;
  for_role: { role: string | null; rank: number } | null;
  discovery: { webmcp: string; window_api: string; manual_json: string; llms_txt: string; in_page: string; accessible_ui: string };
  tools: { name: string; method: string; title: string; description: string; read_only: boolean; input_schema: Record<string, unknown> }[];
  reads: { what: string; offline: boolean };
  writes: { how: string; deletes: string; server_authority: string; functions: Record<WriteAction, ManualFunction[]> };
  roles: typeof ROLE_TABLE;
  rules: string[];
};

const toManualFunction = (f: RegistryFunction): ManualFunction => ({
  id: f.function_id,
  label: f.label,
  module: f.module,
  action: actionOf(f.function_id),
  min_role: rankWord(f.min_role_rank),
  min_role_rank: f.min_role_rank,
  money_sensitive: f.money_sensitive,
  params: [...f.declared_params],
  required: f.required_params.map((r) => ({ name: r.name, label: r.label, any_of: [...r.any_of] })),
});

/**
 * Registry functions this surface never runs, whatever the role (api.ts decide()): a new project is made online in PROJEXA, because an
 * op with no project cannot go through the outbox. lf-e11: the manual used to list it anyway, so every AI that read the manual was
 * told it could create a project and was then always refused.
 */
export const NOT_ON_THIS_SURFACE: ReadonlySet<string> = new Set(["create_project"]);

/** Without `rank`: every function (the static manual). With it: only what that rank may use. */
export function buildManual(forRole?: { rank: number; role: string | null }): Manual {
  const all = functionsForRank(forRole ? forRole.rank : Number.POSITIVE_INFINITY);
  const usable = (fs: RegistryFunction[]) => fs.filter((f) => !NOT_ON_THIS_SURFACE.has(f.function_id));
  const groups = { create: usable(all.create), update: usable(all.update), delete: usable(all.delete) };
  return {
    product: "PROJEXA",
    manual_version: MANUAL_VERSION,
    registry_commit: REGISTRY_SOURCE_COMMIT,
    surface: "window.projexa.ai",
    software_can_be_changed: false,
    software_statement: SOFTWARE_STATEMENT,
    for_role: forRole ? { role: forRole.role, rank: forRole.rank } : null,
    discovery: {
      webmcp: "When the browser has navigator.modelContext (WebMCP), the tools below are registered there automatically on every signed-in PROJEXA page.",
      window_api: "window.projexa.ai -- async methods manifest(), list(kind, {projectId, filter, limit}), get(kind, id), search(text, {projectId}), create(functionId, params), update(functionId, record, params), delete(functionId, record, params), manual(), drafts().",
      manual_json: "/ai-manual.json (static, no personal data)",
      llms_txt: "/llms.txt (static, plain words)",
      in_page: "<script type=\"application/json\" id=\"px-ai-manual\"> on every signed-in page",
      accessible_ui: "Every main control has an accessible name and role, so an agent that drives the page can use it the way a person would.",
    },
    tools: TOOLS.map((t) => ({ name: t.name, method: t.method, title: t.title, description: t.description, read_only: t.readOnly, input_schema: t.inputSchema })),
    reads: {
      what: "Everything the person may see, as the server already scoped it for their organisation, projects and role (money hidden where the role hides it). Reads come from this laptop's copy and work with no internet.",
      offline: true,
    },
    writes: {
      how: "A write is a named function of the PROJEXA registry. It is checked on this laptop against the person's role first, saved here at once, and sent to the server when it can be reached.",
      deletes: "A delete only makes a DRAFT the person confirms with one click in PROJEXA, unless the person switched on \"let my AI act without asking\"; a money-sensitive removal (money_sensitive: true) is a draft even then. An AI cannot confirm a draft.",
      server_authority: "The server re-checks every write as the person with their live role, and may still refuse it; money and approval figures are always recomputed by the server.",
      functions: {
        create: groups.create.map(toManualFunction),
        update: groups.update.map(toManualFunction),
        delete: groups.delete.map(toManualFunction),
      },
    },
    roles: ROLE_TABLE,
    rules: [
      "Act only for the signed-in person, only on their organisation's data, only as their role allows.",
      "Never ask for, store or send passwords or tokens: none are needed, the surface already runs as the person.",
      "Use only the functions listed for this person; anything else is refused in plain words.",
      "A new project is made by the person in PROJEXA while online; everything inside a project can be made here, offline too.",
      SOFTWARE_STATEMENT,
    ],
  };
}

/** The manual in plain words (llms.txt: a title, a one-line summary, then sections). */
export function manualText(manual: Manual): string {
  const line = (f: ManualFunction) => `- ${f.id} -- ${f.label} (${f.module}; ${f.min_role} or higher${f.money_sensitive ? "; money: the server recomputes" : ""}). Params: ${f.params.join(", ") || "none"}. Required: ${f.required.map((r) => r.name).join(", ") || "none"}.`;
  const w = manual.writes.functions;
  return [
    "# PROJEXA",
    "",
    "> PROJEXA is construction project management that runs on the person's own laptop. Their browser AI can read and change THEIR data, as them, with their role, offline too. No AI can change the software.",
    "",
    "## The software cannot be changed",
    "",
    manual.software_statement,
    "",
    "## How to find it",
    "",
    `- WebMCP: ${manual.discovery.webmcp}`,
    `- In JavaScript: ${manual.discovery.window_api}`,
    `- Manual (JSON): ${manual.discovery.manual_json}`,
    `- In the page: ${manual.discovery.in_page}`,
    `- The page itself: ${manual.discovery.accessible_ui}`,
    "",
    "## Tools",
    "",
    ...manual.tools.map((t) => `- ${t.name} (window.projexa.ai.${t.method}): ${t.description}`),
    "",
    "## Reading",
    "",
    manual.reads.what,
    "",
    "## Writing",
    "",
    manual.writes.how,
    manual.writes.deletes,
    manual.writes.server_authority,
    "",
    `### Create (${w.create.length})`,
    "",
    ...w.create.map(line),
    "",
    `### Update (${w.update.length})`,
    "",
    ...w.update.map(line),
    "",
    `### Delete (${w.delete.length})`,
    "",
    ...w.delete.map(line),
    "",
    "## Roles",
    "",
    ...manual.roles.map((r) => `- rank ${r.rank}, ${r.word}: ${r.roles.join(", ")}`),
    "",
    "## Rules",
    "",
    ...manual.rules.map((r) => `- ${r}`),
    "",
  ].join("\n");
}
