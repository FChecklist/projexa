// The person's choice "do not use my machine to help": stored in the laptop's own database (meta), never on the server.
import type { LocalDb } from "../local-db";

export const JOBS_OPT_OUT_KEY = "jobs:opt-out";

export async function readJobsOptOut(db: Pick<LocalDb, "getMeta">): Promise<boolean> {
  return (await db.getMeta<boolean>(JOBS_OPT_OUT_KEY)) === true;
}
export async function writeJobsOptOut(db: Pick<LocalDb, "setMeta">, optedOut: boolean): Promise<void> {
  await db.setMeta(JOBS_OPT_OUT_KEY, optedOut);
}
