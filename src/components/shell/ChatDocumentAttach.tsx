"use client";

// PROJEXA-BUILD-002 WP-10, way 2: attach a file in the chat. The composer's attach control (DropZone) takes a workbook and routes it to the
// SAME "make a project from a file" flow as the upload screen (use-document-job.ts, POST /api/projects/from-document), and shows what came
// back in the chat: the progress and the result panel in the composer, and a saved message with a link in the shell's message region above
// it when the project is created.
//
// WHERE IT APPEARS. The composer's attach slot is filled by a module's own attach policy on the screens that declare one (Documents,
// Permits, Drawings, Scope: src/lib/card-catalogue.ts); those keep their behaviour. On every other screen the slot was empty, and this
// control fills it, so the chat takes a project file anywhere. M24Shell decides which of the two is mounted.
//
// A FILE HERE MAKES A NEW PROJECT, so the product is asked for when the organisation has more than one (VERIDIAN needs it). Nothing is
// created until the person confirms, exactly as on the upload screen. Role: every role except client_viewer sees the control.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DropZone, type AttachedFile } from "@/components/shell/DropZone";
import { DocumentJobPanel } from "@/components/upload/DocumentJobPanel";
import { useDocumentJob } from "@/hooks/use-document-job";
import { canSendProjectDocument } from "@/lib/project-document-access";
import { checkDocumentFile, DOCUMENT_POLICY, loadProductOptions, type FromDocumentClient } from "@/lib/project-from-document-client";
import { useShellMessages } from "@/lib/shell-messages";

export type ChatProduct = { id: string; name: string };

/** The organisation's products for the picker. */
export const loadChatProducts = loadProductOptions;

const projectHref = (projectId: string) => `/dashboard/project?projectId=${encodeURIComponent(projectId)}`;

export function ChatDocumentAttach({
  role,
  client,
  loadProducts,
  disabled = false,
  timing,
}: {
  role: string | null | undefined;
  client: FromDocumentClient;
  /** The organisation's products. Called once, when the first file is attached. */
  loadProducts: () => Promise<ChatProduct[]>;
  disabled?: boolean;
  timing?: { intervalMs?: number; timeoutMs?: number };
}) {
  const job = useDocumentJob(client, timing);
  const messages = useShellMessages();
  const [attached, setAttached] = useState<AttachedFile | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [products, setProducts] = useState<ChatProduct[] | null>(null);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productId, setProductId] = useState("");
  const announced = useRef<string | null>(null);

  const created = job.phase.kind === "created" ? job.phase : null;
  useEffect(() => {
    if (!created || announced.current === created.projectId) return;
    announced.current = created.projectId;
    messages.push({
      kind: "saved",
      text: created.duplicate ? `${created.fileName} already made a project` : `Project created from ${created.fileName}`,
      href: projectHref(created.projectId),
      linkLabel: "Open the project",
    });
  }, [created, messages]);

  const fetchProducts = useCallback(async () => {
    try {
      const list = await loadProducts();
      setProducts(list);
      setProductsError(null);
      if (list.length === 1) setProductId(list[0].id);
    } catch {
      setProductsError("Could not load the products. Try again in a minute.");
    }
  }, [loadProducts]);

  if (!canSendProjectDocument(role)) return null;

  function onAdd(incoming: File[]) {
    const picked = incoming[0];
    if (!picked) return;
    job.reset();
    const error = checkDocumentFile(picked);
    setFile(error ? null : picked);
    setAttached({ id: "chat-doc", name: picked.name, size: picked.size, status: error ? "error" : "ready", progress: 0, error: error ?? undefined });
    if (!error && products === null) void fetchProducts();
  }

  function onRemove() {
    job.reset();
    setFile(null);
    setAttached(null);
  }

  const needsProduct = products !== null && products.length > 1 && !productId;
  const canRead = file !== null && productId !== "" && !job.busy;

  return (
    <div className="flex flex-col gap-2" data-testid="chat-document-attach">
      <DropZone policy={DOCUMENT_POLICY} files={attached ? [attached] : []} onAdd={onAdd} onRemove={onRemove} storageError={productsError} onRetry={() => void fetchProducts()} disabled={disabled || job.busy} />
      {file && job.phase.kind === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          {products !== null && products.length > 1 && (
            <label className="flex items-center gap-1.5 text-[12px]">
              Product
              <select className="h-8 rounded-md border border-input bg-transparent px-2 text-[12px]" value={productId} onChange={(e) => setProductId(e.target.value)} data-testid="chat-doc-product">
                <option value="">Choose</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="veri-view-tab self-start" style={{ minHeight: 32 }} disabled={!canRead} onClick={() => void job.start({ file, productId })} data-testid="chat-doc-read">
            Read the file
          </button>
          {needsProduct && <span className="text-[11px]" style={{ color: "var(--color-ct-muted)" }}>Choose a product first.</span>}
        </div>
      )}
      <DocumentJobPanel
        phase={job.phase}
        onCreate={(choice) => void job.finish(choice)}
        onReset={onRemove}
        onAcceptShortfall={file ? () => void job.start({ file, productId, acknowledgeShortfall: true }) : undefined}
        projectHref={projectHref}
      />
      {job.phase.kind === "parked" && (
        <Link className="text-[12px] underline" href={`/projects/from-file?job=${job.sha256 ?? ""}`}>Open it on its own screen</Link>
      )}
    </div>
  );
}
