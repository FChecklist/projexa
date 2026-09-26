"use client";

// PROJEXA-BUILD-002 WP-10, way 1 (register row AW-601): "Make a project from a file". A person picks a workbook, PROJEXA sends it to
// VERIDIAN (POST /api/projects/from-document), the file is read, and the person sees what was read: the deterministic reader's result, the
// control totals against what the file prints, and any questions. When nothing is left to ask, or the person has read the questions, one
// button creates the project and its BOQ, and the person lands on it. No line of the BOQ is typed.
//
// ONE CONFIRM STAYS (plan decision D-1): the file is first read with mode=prepare, which creates nothing; the project is created by the
// second send of the same file. The server finishes the parked job from what it stored, so the second send costs no second model call.
//
// A job this browser sent earlier can be opened again (?job=<sha256> from Proposals and questions). Its state is read from the server;
// finishing it needs the file once more, and a different file is refused because its hash is not the job's.
//
// Role: every role except the read-only client_viewer sees the form (project-document-access.ts); the server is the gate.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentJobPanel, type CreateChoice } from "@/components/upload/DocumentJobPanel";
import { useDocumentJob } from "@/hooks/use-document-job";
import { useOrgRole } from "@/hooks/use-org-role";
import { canSendProjectDocument, SEND_DOCUMENT_ROLE_NOTE } from "@/lib/project-document-access";
import { checkDocumentFile, DOCUMENT_ACCEPT, DOCUMENT_POLICY, getFromDocumentClient, loadProductOptions, type FromDocumentClient, type ProductOption } from "@/lib/project-from-document-client";
import { acceptList, formatSize } from "@/lib/attachments";
import { invalidateShell } from "@/lib/shell-store";

export const projectHrefFor = (projectId: string) => `/dashboard/project?projectId=${encodeURIComponent(projectId)}`;

export function UploadProjectDocumentScreen({
  role,
  products: givenProducts,
  loadProducts = loadProductOptions,
  resumeSha256,
  client,
  timing,
}: {
  role: string | null | undefined;
  /** The organisation's products when the caller already has them. When absent the screen reads them once, through loadProducts. */
  products?: ProductOption[];
  loadProducts?: () => Promise<ProductOption[]>;
  /** The hash of a job this browser sent earlier, to open again. */
  resumeSha256?: string | null;
  client: FromDocumentClient;
  timing?: { intervalMs?: number; timeoutMs?: number };
}) {
  const router = useRouter();
  const job = useDocumentJob(client, timing);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<ProductOption[] | null>(givenProducts ?? null);
  const [productsError, setProductsError] = useState<string | null>(null);
  const products = loaded ?? [];
  const [productId, setProductId] = useState(givenProducts && givenProducts.length === 1 ? givenProducts[0].id : "");
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const resumed = useRef(false);

  useEffect(() => {
    if (resumeSha256 && !resumed.current) {
      resumed.current = true;
      void job.resume(resumeSha256);
    }
  }, [resumeSha256, job]);

  useEffect(() => {
    if (givenProducts) return;
    let cancelled = false;
    loadProducts().then(
      (list) => {
        if (cancelled) return;
        setLoaded(list);
        if (list.length === 1) setProductId(list[0].id);
      },
      () => {
        if (!cancelled) setProductsError("the request did not complete");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [givenProducts, loadProducts]);

  const created = job.phase.kind === "created" ? job.phase.projectId : null;
  useEffect(() => {
    // the shell keeps the project list in a session store, so the new project appears in the top rail's switcher at once
    if (created) invalidateShell("projects");
  }, [created]);

  if (!role) return null;
  if (!canSendProjectDocument(role)) {
    return <p className="text-sm text-muted-foreground" data-testid="doc-role-note">{SEND_DOCUMENT_ROLE_NOTE}</p>;
  }

  const idle = job.phase.kind === "idle" || job.phase.kind === "failed";
  const missing: string[] = [];
  if (!file) missing.push("a file");
  if (!productId) missing.push("a product");
  const readDisabled = job.busy || missing.length > 0 || fileError !== null;

  async function onPick(picked: File | null) {
    setNote(null);
    setFile(picked);
    setFileError(picked ? checkDocumentFile(picked) : null);
    if (picked && job.sha256 && job.phase.kind === "parked") {
      // a job is open and waits for its file: the picked one has to be the same
      const reason = await job.supplyFile(picked, productId);
      if (reason) setNote(reason);
    }
  }

  async function onRead() {
    if (!file || readDisabled) return;
    await job.start({ file, productId, name });
  }

  async function onCreate(choice: CreateChoice) {
    if (!job.hasFile) {
      setNote("Choose the same file again to finish. This page does not keep it.");
      return;
    }
    if (!productId) {
      setNote("Choose a product for the project first.");
      return;
    }
    await job.finish({ ...choice, name, productId });
  }

  async function onAcceptShortfall() {
    if (!file) return;
    await job.start({ file, productId, name, acknowledgeShortfall: true });
  }

  const nameField = (
    <div className="space-y-1.5">
      <Label htmlFor="doc-project-name">Project name (optional)</Label>
      <Input id="doc-project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave empty to use the name found in the file" data-testid="doc-name" />
    </div>
  );

  const productField = (
    <div className="space-y-1.5">
      <Label htmlFor="doc-product">Product</Label>
      <select
        id="doc-product"
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        data-testid="doc-product"
      >
        <option value="">Choose a product</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {productsError && <p className="text-sm text-px-error" role="alert">Could not load the products: {productsError}</p>}
    </div>
  );

  const waitingForFile = job.phase.kind === "parked" && !job.hasFile;

  return (
    <div className="space-y-5" data-testid="upload-project-document">
      {(idle || waitingForFile) && (
        <div className="space-y-4 rounded-md border border-border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="doc-file">{waitingForFile ? "Choose the same file again to finish" : "Project file"}</Label>
            <Input
              id="doc-file"
              ref={fileInput}
              type="file"
              accept={DOCUMENT_ACCEPT.join(",")}
              onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
              data-testid="doc-file"
            />
            <p className="text-xs text-muted-foreground">
              Accepted: {acceptList(DOCUMENT_POLICY)}, up to {formatSize(DOCUMENT_POLICY.maxBytes)}. Excel (.xlsx) workbooks are read today; other types are refused with a reason.
            </p>
            {fileError && <p className="text-sm text-px-error" role="alert" data-testid="doc-file-error">{fileError}</p>}
          </div>

          {productField}
          {!waitingForFile && (
            <>
              {nameField}
              {missing.length > 0 && <p className="text-sm text-muted-foreground" data-testid="doc-read-reason">Choose {missing.join(" and ")} to continue.</p>}
              <Button type="button" onClick={() => void onRead()} disabled={readDisabled} data-testid="doc-read">
                Read the file
              </Button>
            </>
          )}
        </div>
      )}

      {note && <p className="text-sm text-px-error" role="alert" data-testid="doc-note">{note}</p>}

      <DocumentJobPanel
        phase={job.phase}
        onCreate={(choice) => void onCreate(choice)}
        onReset={() => {
          job.reset();
          setFile(null);
          setFileError(null);
          setNote(null);
          if (fileInput.current) fileInput.current.value = "";
        }}
        onAcceptShortfall={file ? () => void onAcceptShortfall() : undefined}
        projectHref={projectHrefFor}
        projectNameSlot={
          job.phase.kind === "parked" && job.hasFile ? (
            <>
              {!productId && productField}
              {nameField}
            </>
          ) : undefined
        }
      />

      {job.phase.kind === "reading" && (
        <Button type="button" variant="outline" size="sm" onClick={() => job.cancel()} data-testid="doc-cancel">
          Stop watching
        </Button>
      )}
      {created && (
        <Button type="button" variant="outline" size="sm" onClick={() => router.push(projectHrefFor(created))} data-testid="doc-go">
          Go to the project
        </Button>
      )}
    </div>
  );
}

export default function UploadProjectDocumentClient(props: { resumeSha256?: string | null }) {
  const { role } = useOrgRole();
  return <UploadProjectDocumentScreen role={role} client={getFromDocumentClient()} {...props} />;
}
