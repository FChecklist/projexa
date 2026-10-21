"use client";

// GUIDED ERRORS (G3): what a person sees when a shared link (report, attendance summary, minutes of meeting) no longer opens. It used to be a bare
// "not found" page or one line of text; it is now the full guide: what happened, why, the numbered steps, and the way on. The page is public (no
// session), so the guide's own text is all the help there is -- it tells the reader to ask the sender for a fresh link.
import { GuidedError } from "@/components/GuidedError";

export function ExpiredShareNotice({ kind, token }: { kind: "report" | "attendance" | "mom"; token: string }) {
  const sentence = "This link has expired - ask the sender for a new one";
  const ctx =
    kind === "mom"
      ? { route: `/shared/mom/${token}`, search: "", status: 404, serverMessage: sentence, entityId: token }
      : { route: `/share/${kind}/${token}`, search: "", status: 404, code: "SHARE_EXPIRED", serverMessage: sentence, apiPath: `/share/${kind}/${token}`, entityId: token };
  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <GuidedError ctx={ctx} message={sentence} />
    </div>
  );
}

export default ExpiredShareNotice;
