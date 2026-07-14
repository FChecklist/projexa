"use client";

import { useEffect, useState } from "react";

// Priority 15 Wave 2: the "which role is this user" mechanism already
// existed (GET /api/organization, backed by requireAuth()'s PROJEXA-side
// membership lookup -- see SettingsClient.tsx's existing use of it) but no
// other client component had a reusable way to consume it. This is NOT the
// same role axis as VERIDIAN's own user_role enum (admin/manager/member/
// veridian_admin/...) -- PROJEXA has its own local 'owner' | 'admin' |
// 'member' tenant role from its own `memberships` table, since PROJEXA
// users authenticate against PROJEXA's own Supabase project, not
// VERIDIAN's. Server-side VERIDIAN calls made on a PROJEXA user's behalf
// still go through the single shared Bearer API key (see
// veridian-client.ts) -- requireRoleOrScope() on that side is gated on the
// key's scope, not this role. This hook is a UX affordance only: it hides
// admin-only actions from users who can't complete them, it is not itself
// the security boundary.
export type OrgRole = "owner" | "admin" | "member";

const HR_ADMIN_ROLES: ReadonlySet<OrgRole> = new Set(["owner", "admin"]);

export function useOrgRole() {
  const [role, setRole] = useState<OrgRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/organization");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.role) setRole(data.role as OrgRole);
      } catch {
        // Fails open to "no role known" -- callers should treat null the
        // same as "not an HR admin" (isHrAdmin below already does this).
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { role, loading, isHrAdmin: role != null && HR_ADMIN_ROLES.has(role) };
}
