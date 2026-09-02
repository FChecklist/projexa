import ScopeObjectClient from "@/components/ScopeObjectClient";

// Real-screen conversion (2026-08-30): SCOPE/BOQ's first real Object Page
// route, replacing ScopeClient.tsx's old "View" Dialog popup. Same thin
// pass-through pattern as permits/[id]/page.tsx (GLOBAL: "route files stay
// THIN") -- all behaviour lives in ScopeObjectClient and the kit's
// ObjectScreen.
export default async function ScopeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ imported?: string }>;
}) {
  const { id } = await params;
  // R67 D-25: the import screen unmounts with the navigation, so its own
  // message band would vanish with it -- the confirmation travels here in
  // ?imported= and is rendered as a persistent notice, the same mechanism
  // MoMsClient's ?deleted= uses.
  const { imported } = await searchParams;
  return (
    <div className="flex-1">
      <ScopeObjectClient boqId={id} importedNotice={imported ?? null} />
    </div>
  );
}
