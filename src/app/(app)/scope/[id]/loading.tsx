// R67 F-34 (audit recommendation R-290). Next renders this the moment the
// navigation into /scope/<id> starts, so the breadcrumb and the object frame are on
// screen before page.tsx has resolved anything -- and, combined with the same
// frame inside the object client's own waiting state, the screen never falls
// back to a bare "Loading..." between the two.
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import { SCOPE_OBJECT_BREADCRUMB } from "@/lib/object-breadcrumbs";

export default function Loading() {
  return (
    <div className="flex-1">
      <KitObjectScreen
        loading
        breadcrumb={SCOPE_OBJECT_BREADCRUMB.breadcrumb}
        label={SCOPE_OBJECT_BREADCRUMB.label}
        actions={SCOPE_OBJECT_BREADCRUMB.actions}
      />
    </div>
  );
}
