import MoMObjectClient from "@/components/MoMObjectClient";

// R67 D-17: the two query params Save on /moms/new hands over are read HERE,
// in the server component, and passed down as props -- rather than with
// useSearchParams() inside the client component, which Next requires to sit
// behind its own Suspense boundary.
export default async function MoMObjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string; created?: string }>;
}) {
  const { id } = await params;
  const { focus, created } = await searchParams;
  return (
    <div className="flex-1">
      <MoMObjectClient meetingId={id} focusMinutes={focus === "minutes"} justCreated={created === "1"} />
    </div>
  );
}
