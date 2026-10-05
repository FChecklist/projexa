// AUDIT-100 A1: is the Vercel team on the free Hobby plan with no paid add-ons? READ-ONLY: one GET of the team through the Vercel CLI the laptop is
// already signed in with (`vercel api`). It changes nothing, prints no token, and never calls a billing or purchase endpoint.
//
//   node scripts/verify/vercel-plan-check.mjs [teamId]       exit 0 = plan is "hobby" and no add-on is listed; exit 1 = anything else
//
// The recorded result of the 2026-10-05 run is ai-os/audit37/A1_VERCEL_PLAN_EVIDENCE_2026-10-05.md.

import { execFileSync } from "node:child_process";

const TEAM_ID = process.argv[2] ?? process.env.VERCEL_TEAM_ID ?? "team_Iqx3zyb7sDdsdzcNskCFFsHD"; // VERIDIAN (an id, not a secret)

export function summarise(rawOutput) {
  const start = rawOutput.indexOf("{");
  if (start < 0) throw new Error("the Vercel CLI printed no JSON (is it signed in? try `vercel whoami`)");
  const team = JSON.parse(rawOutput.slice(start));
  const billing = team.billing ?? {};
  return {
    slug: team.slug ?? null,
    plan: billing.plan ?? null,
    currency: billing.currency ?? null,
    addons: Object.keys(billing.addons ?? {}),
    checkedAt: new Date().toISOString(),
  };
}

export function verdict(summary) {
  const problems = [];
  if (summary.plan !== "hobby") problems.push(`plan is ${JSON.stringify(summary.plan)}, not "hobby"`);
  if (summary.addons.length) problems.push(`paid add-ons listed: ${summary.addons.join(", ")}`);
  return problems;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let out;
  try {
    out = execFileSync("vercel", ["api", `/v2/teams/${TEAM_ID}`], { encoding: "utf8", shell: process.platform === "win32", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, timeout: 90_000 });
  } catch (err) {
    console.error(`FAIL could not read the team: ${String(err.message).split("\n")[0]}`);
    process.exit(1);
  }
  const summary = summarise(out);
  console.log(JSON.stringify(summary));
  const problems = verdict(summary);
  for (const p of problems) console.error("FAIL " + p);
  process.exit(problems.length ? 1 : 0);
}
