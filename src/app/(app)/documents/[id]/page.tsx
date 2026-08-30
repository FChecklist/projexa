import DocumentObjectClient from "@/components/DocumentObjectClient";

// Real-screen conversion (2026-08-30): the Documents module's first Object
// Page -- previously an uploaded file could never be viewed/downloaded or
// have its metadata corrected again. Thin pass-through, same pattern as
// permits/[id]/page.tsx.
export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <DocumentObjectClient documentId={id} />
    </div>
  );
}
