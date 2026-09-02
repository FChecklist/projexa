import WorkProgressEntryObjectClient from "@/components/WorkProgressEntryObjectClient";

// R67 lane D22 (item D-77, rec R-289): Work Progress' first real Object Page.
// Every other module in this app got one in the 2026-08-30 conversion; the
// entries a site crew records every single day did not, so the list was a dead
// end. Thin pass-through, same pattern as scope/[id]/page.tsx (GLOBAL: "route
// files stay THIN").
export default async function WorkProgressEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <WorkProgressEntryObjectClient entryId={id} />
    </div>
  );
}
