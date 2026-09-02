import MoMObjectClient from "@/components/MoMObjectClient";

// R67 D-17: ?created=1 is read HERE, in the server component, and passed down
// as a prop -- rather than with useSearchParams() inside the client component,
// which Next requires to sit behind its own Suspense boundary.
//
// ?focus= is deliberately NOT read here: lane A's FocusRequest inside
// MoMObjectClient already owns it (it is the composer's contract and targets
// both the minutes box and the share control by data-focus), and two
// mechanisms for the same query param is how they drift apart.
export default async function MoMObjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const { created } = await searchParams;
  return (
    <div className="flex-1">
      <MoMObjectClient meetingId={id} justCreated={created === "1"} />
    </div>
  );
}
