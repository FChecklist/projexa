import { SiteInstructionView } from "@/components/SiteInstructionViews";

// R-C14: one site instruction, where the create screen lands after Save. Thin pass-through; the behaviour is in the client.
export default async function SiteInstructionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ projectId?: string }> }) {
  const { id } = await params;
  const { projectId } = await searchParams;
  return (
    <div className="flex-1 p-6">
      <SiteInstructionView id={id} projectId={projectId ?? null} />
    </div>
  );
}
