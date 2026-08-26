import PermitObjectClient from "@/components/PermitObjectClient";

// R42 seq21: PERMITS.OBJECT -- the first genuinely new detail route this
// screen_spec audit found (only 3 [id] routes existed across all 49 modules
// before this). Server component stays a thin param pass-through per
// GLOBAL's own "route files stay THIN" rule -- all behaviour lives in
// PermitObjectClient (mode/draft/autosave) and the kit's ObjectScreen.
export default async function PermitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <PermitObjectClient permitId={id} />
    </div>
  );
}
