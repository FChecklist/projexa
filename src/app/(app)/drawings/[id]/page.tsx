import DrawingObjectClient from "@/components/DrawingObjectClient";

// Real-screen conversion (2026-08-30): the Drawings & 3D module's first
// Object Page -- previously rows only had a bare "Open" link, no detail
// view. Thin pass-through, same pattern as permits/[id]/page.tsx.
// projectId comes via query string (the documents/[id] DTO doesn't carry
// linkedEntityId) -- same as scope/new's own pattern for a project-scoped
// create screen.
export default async function DrawingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ projectId?: string }> }) {
  const { id } = await params;
  const { projectId } = await searchParams;
  return (
    <div className="flex-1">
      <DrawingObjectClient drawingId={id} projectId={projectId ?? ""} />
    </div>
  );
}
