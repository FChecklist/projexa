import ScopeObjectClient from "@/components/ScopeObjectClient";

// Real-screen conversion (2026-08-30): SCOPE/BOQ's first real Object Page
// route, replacing ScopeClient.tsx's old "View" Dialog popup. Same thin
// pass-through pattern as permits/[id]/page.tsx (GLOBAL: "route files stay
// THIN") -- all behaviour lives in ScopeObjectClient and the kit's
// ObjectScreen.
export default async function ScopeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <ScopeObjectClient boqId={id} />
    </div>
  );
}
