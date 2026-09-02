import WorkProgressObjectClient from "@/components/WorkProgressObjectClient";

// R67 D-28: the first object page Work Progress has ever had. Before this the
// module was create-only -- a row on the list opened nothing.
//
// `?logged=1` is what the form hands over on a successful save, so the user
// lands ON the entry they just made and sees it confirmed there. Read here, in
// the server component, rather than with useSearchParams() inside the client
// component, which Next requires to sit behind its own Suspense boundary.
export default async function WorkProgressObjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ logged?: string }>;
}) {
  const { id } = await params;
  const { logged } = await searchParams;
  return (
    <div className="flex-1">
      <WorkProgressObjectClient entryId={id} justLogged={logged === "1"} />
    </div>
  );
}
