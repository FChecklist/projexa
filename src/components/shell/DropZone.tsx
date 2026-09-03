"use client";

// R67 WS-C (C-07) -- THE ATTACH CONTROL IN THE COMPOSER'S INPUT BAND.
//
// A PROJEXA component, never a kit one (D-09). The kit's Composer has had an
// `attachSlot` since it shipped and PROJEXA never filled it, so the only way
// to get a file into the product was to find the module's own create form
// first.
//
// FOUR RULES IT ENFORCES.
//
// 1. A WORD, NEVER AN ICON ALONE, AND THE LIMITS ARE IN THE WORD. The button
//    reads "Attach PDF, up to 25 MB". M24: "An icon you must learn is a
//    puzzle; a site engineer must read this on his first morning."
// 2. THE REFUSAL HAPPENS BEFORE THE BYTES MOVE, IN WORDS. "Too large: 30 MB,
//    limit 25 MB" is decided in src/lib/attachments.ts and shown on the chip,
//    not discovered from a 413 after a two-minute upload on site LTE.
// 3. PROGRESS IS REAL AND CANCEL IS REAL. A per-file bar driven by the actual
//    XHR upload event, and a Cancel that aborts the request -- a Cancel that
//    leaves the upload running is a lie.
// 4. A STORAGE FAILURE SAYS SO. "Uploads are unavailable right now — Retry",
//    never a false success and never a bare 500.

import { useRef, useState } from "react";
import { acceptList, formatSize, type AttachPolicy } from "@/lib/attachments";

/** One file in the tray. `error` is the words the chip shows. */
export type AttachedFile = {
  id: string;
  name: string;
  size: number;
  status: "ready" | "uploading" | "done" | "error";
  /** 0-100, only meaningful while `status` is "uploading". */
  progress: number;
  error?: string;
};

export type DropZoneProps = {
  policy: AttachPolicy;
  files: AttachedFile[];
  /** The browser's own File objects. The parent checks and stores them. */
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  /** Aborts an upload in flight. Only rendered while one is. */
  onCancel?: (id: string) => void;
  /** A storage-level failure, in the backend's own words. */
  storageError?: string | null;
  onRetry?: () => void;
  disabled?: boolean;
};

export function DropZone({
  policy,
  files,
  onAdd,
  onRemove,
  onCancel,
  storageError,
  onRetry,
  disabled = false,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function take(list: FileList | null) {
    if (!list || list.length === 0) return;
    onAdd(Array.from(list));
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-1"
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer?.files ?? null);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="veri-view-tab shrink-0 disabled:opacity-40"
          style={dragging ? { borderColor: "var(--color-ct-teal)" } : undefined}
        >
          {policy.label}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple={policy.maxFiles > 1}
          accept={policy.accept.join(",")}
          aria-label={policy.label}
          className="sr-only"
          onChange={(e) => {
            take(e.target.files);
            // Reset so re-picking the SAME file still fires a change event --
            // otherwise a user who fixed nothing and picked the same file
            // again gets no response at all.
            e.target.value = "";
          }}
        />
        {dragging && (
          <span className="text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
            Drop to attach {acceptList(policy)}
          </span>
        )}
      </div>

      {/* THE STORAGE FAILURE, IN WORDS, WITH A WAY OUT. */}
      {storageError && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[11.5px]" style={{ color: "var(--color-veri-status-late)" }}>
          <span>{storageError}</span>
          {onRetry && (
            <button type="button" className="veri-view-tab" onClick={onRetry}>
              Retry
            </button>
          )}
        </p>
      )}

      {files.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px]"
              style={{
                borderColor: f.error ? "var(--color-veri-status-late)" : "var(--color-ct-border2)",
                color: f.error ? "var(--color-veri-status-late)" : "var(--color-ct-navy)",
              }}
            >
              <span className="max-w-[16ch] truncate" title={f.name}>
                {f.name}
              </span>
              {f.error ? (
                // THE CHIP CARRIES THE REASON. C-07's acceptance reads this
                // exact string off the chip.
                <span role="alert">{f.error}</span>
              ) : f.status === "uploading" ? (
                <>
                  <span aria-hidden className="inline-block h-1 w-10 rounded-full" style={{ background: "var(--color-ct-cloud)" }}>
                    <span
                      className="block h-1 rounded-full"
                      style={{ width: `${Math.max(2, Math.min(100, f.progress))}%`, background: "var(--color-ct-teal)" }}
                    />
                  </span>
                  <span role="status">{Math.round(f.progress)}%</span>
                  {onCancel && (
                    <button type="button" className="veri-view-tab" onClick={() => onCancel(f.id)}>
                      Cancel
                    </button>
                  )}
                </>
              ) : f.status === "done" ? (
                <span style={{ color: "var(--color-veri-status-done)" }}>saved</span>
              ) : (
                <span style={{ color: "var(--color-ct-muted)" }}>{formatSize(f.size)}</span>
              )}
              {f.status !== "uploading" && (
                <button
                  type="button"
                  onClick={() => onRemove(f.id)}
                  aria-label={`Remove ${f.name}`}
                  className="veri-icon-btn"
                  style={{ width: 16, height: 16, fontSize: 10 }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
