// R67 F-18 (decision D-04). Next.js renders this the moment the navigation
// starts, so the module's frame -- title, tabs, real column heads -- is on
// screen while page.tsx is still resolving anything at all. Before this, the
// three serial round-trips in page.tsx ran BEFORE the first byte, so the user
// looked at the previous screen for 1.5-1.65 s and then at a spinner.
import { ModuleListSkeleton } from "@/components/ModuleListSkeleton";
import { BOQ_LIST_COLUMNS } from "@/lib/module-list-columns";

export default function Loading() {
  return (
    <ModuleListSkeleton
      title="Scope of Work (BOQ)"
      columns={BOQ_LIST_COLUMNS}
      tabs={["BOQ","Cost Variance"]}
      actions={["+ New"]}
    />
  );
}
