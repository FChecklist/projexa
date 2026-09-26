import Link from "next/link";
import ProposalsClient from "@/components/proposals/ProposalsClient";
import { PageHeading } from "@/components/PageHeading";

// PROJEXA-BUILD-002 WP-10: "Proposals and questions". What waits for a person: the proposals an AI or an email prepared (approve them
// here) and the files sent from this browser to be made into projects that stopped with questions. All behaviour and every read is in
// ProposalsClient, through this app's own proxies; nothing is read on the server here, so the page renders at once and reports a failed
// read in words instead of an empty list.
export default function ProposalsPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Proposals and questions" />
      <p className="text-sm text-muted-foreground">
        Have a workbook to turn into a project? <Link className="underline" href="/projects/from-file">Make a project from a file</Link>.
      </p>
      <ProposalsClient />
    </div>
  );
}
