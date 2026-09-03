import WorkProgressObjectClient from "@/components/WorkProgressObjectClient";

// R67 D-28: the object page a logged progress entry never had. A Daily Entry
// row used to be the end of the road -- it showed a truncated remark and a
// percentage, the site photo a site engineer had attached was reachable from
// nowhere in the UI, and a mis-keyed quantity could only be fixed by deleting
// and re-entering.
//
// `?logged=1` is what the form hands over on a successful save, so the user
// lands ON the entry they just made and sees it confirmed there. Read here, in
// the server component, rather than with useSearchParams() inside the client
// component, which Next requires to sit behind its own Suspense boundary.
//
// ─── INTEGRATION TRAIN, decision D-11 point 2 ────────────────────────────────
// Two lanes built this exact route on different foundations, and this is not a
// textual conflict:
//
//   * The version on main (lane D0's WorkProgressEntryObjectClient) is
//     READ-ONLY and resolves the entry by SCANNING THE PROJECT'S LIST, because
//     -- as its own header said -- no per-entry endpoint existed when it was
//     written. It therefore required ?projectId= and could not offer Edit or
//     Delete at all.
//   * This lane ships that endpoint: compliance-tracker's
//     /api/v1/construction/progress/[id] (getProgressEntry/updateProgressEntry/
//     deleteProgressEntry) and PROJEXA's /api/work-progress/[id] proxy.
//
// D-11 point 2 settles it: the endpoint-backed object page wins over the
// list-scan placeholder. Nothing this route could do is lost -- the site
// photos, the honest "couldn't load the photos" wording and the read-only
// facts are all in the surviving component, which additionally has Edit,
// Delete-with-blast-radius and no ?projectId= requirement. Per D-11 point 4
// the placeholder was REMOVED rather than left as unreachable dead code, in a
// commit that names this decision.
export default async function WorkProgressObjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ logged?: string }>;
}) {
  const { id } = await params;
  const { logged } = await searchParams;
  return (
    <div className="flex-1">
      <WorkProgressObjectClient entryId={id} justLogged={logged === "1"} />
    </div>
  );
}
