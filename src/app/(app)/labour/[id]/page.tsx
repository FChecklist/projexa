import RosterObjectClient from "@/components/RosterObjectClient";

// R67 D-34: `created` is the confirmation the New Worker screen hands over
// ("Worker W-0042 added") -- that screen unmounts with the navigation, so its
// own band cannot carry it. Read here, in the server component, rather than
// with useSearchParams() inside the client component, which Next requires to
// sit behind its own Suspense boundary.
export default async function RosterObjectPage({
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
      <RosterObjectClient rosterId={id} createdNotice={created ?? null} />
    </div>
  );
}
