import Link from "next/link";
import UploadProjectDocumentClient from "@/components/upload/UploadProjectDocumentClient";
import { PageHeading } from "@/components/PageHeading";

// PROJEXA-BUILD-002 WP-10, way 1: "Make a project from a file". The screen that /projects/new (the manual form) and /scope/import (a BOQ
// into an existing project, first sheet only) are not: it turns a whole workbook into a new project and its BOQ through VERIDIAN's
// from-document flow (see UploadProjectDocumentClient.tsx).
//
// A thin server route by design, like /projects: nothing is read here. The client reads the product list through this app's own
// /api/products proxy (the org's VERIDIAN key stays on the server either way) and says so in words when that read fails, instead of
// showing an empty picker. ?job=<sha256> opens a job this browser sent earlier (linked from /proposals).
const SHA256 = /^[0-9a-f]{64}$/;

export default async function ProjectFromFilePage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const resumeSha256 = job && SHA256.test(job) ? job : null;
  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Make a project from a file" />
      <p className="text-sm text-muted-foreground">
        Files that stopped with questions, and proposals waiting for approval, are on <Link className="underline" href="/proposals">Proposals and questions</Link>.
      </p>
      <UploadProjectDocumentClient resumeSha256={resumeSha256} />
    </div>
  );
}
