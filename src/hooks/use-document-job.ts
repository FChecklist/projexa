"use client";

// PROJEXA-BUILD-002 WP-10. One file, one job: send a file to be made into a project, watch the job until it stops, and finish it when a person
// says so. The upload screen and the chat attach control both use this hook, so the two ways of sending a file cannot disagree about what
// happens next.
//
//   start()   reads the file and checks it (mode prepare). Nothing is created. The job ends in needs_answers (questions for a person),
//             ready (nothing to ask) or rejected.
//   finish()  the person's confirm: the same file again in mode create, with the acknowledgements they ticked. VERIDIAN finishes a parked
//             job from what it stored, with no second model call, and the project is created when the job reaches created.
//   resume()  a job this browser sent earlier (by the hash of its file): reads it and, when it waits, shows it. Finishing it needs the file
//             again (the browser keeps no file), and finish() refuses a different file.
//
// The phase is one value, never two flags that can disagree. The file lives in a ref and never in state, storage or a log.
import { useCallback, useEffect, useRef, useState } from "react";
import { forgetJob, rememberJob } from "@/lib/document-job-memory";
import { DocumentError, waitForJob, type DocJob, type FromDocumentClient, type JobState } from "@/lib/project-from-document-client";

export type DocumentPhase =
  | { kind: "idle" }
  | { kind: "sending"; fileName: string }
  /** The job exists and is read by the server. `state` is received or reading. */
  | { kind: "reading"; fileName: string; state: JobState }
  /** Waiting for a person: needs_answers (questions) or ready (a confirm is all that is left). */
  | { kind: "parked"; job: DocJob; fileName: string }
  | { kind: "created"; projectId: string; job: DocJob | null; duplicate: boolean; fileName: string }
  | { kind: "failed"; message: string; code: string | null; issues: string[]; fileName: string }

export type StartInput = { file: File; productId: string; name?: string; acknowledgeShortfall?: boolean }
export type FinishInput = { acknowledgeQuestions: boolean; acknowledgeShortfall: boolean; name?: string; productId?: string }

export type UseDocumentJob = {
  phase: DocumentPhase
  /** True from the send until the job stops or the wait ends. */
  busy: boolean
  /** The hash of the file being handled, or of the job being resumed. */
  sha256: string | null
  start: (input: StartInput) => Promise<void>
  finish: (input: FinishInput) => Promise<void>
  /** Reads a job this browser sent earlier. `file` is the file again, when the person has chosen it. */
  resume: (sha256: string, file?: File) => Promise<void>
  /** Hands the file of a resumed job to finish(); refuses a file whose hash is not the job's. Returns the reason, or null when it is accepted. */
  supplyFile: (file: File, productId: string) => Promise<string | null>
  hasFile: boolean
  /** Stops watching. The server keeps reading the file. */
  cancel: () => void
  reset: () => void
}

function failureOf(error: unknown, fileName: string): DocumentPhase {
  if (error instanceof DocumentError) return { kind: "failed", message: error.message, code: error.code, issues: error.issues, fileName }
  return { kind: "failed", message: "Something went wrong. Nothing was changed. Try again in a minute.", code: null, issues: [], fileName }
}

export function useDocumentJob(client: FromDocumentClient, options: { intervalMs?: number; timeoutMs?: number } = {}): UseDocumentJob {
  const [phase, setPhase] = useState<DocumentPhase>({ kind: "idle" })
  const [sha256, setSha256] = useState<string | null>(null)
  const [hasFile, setHasFile] = useState(false)
  const fileRef = useRef<File | null>(null)
  const productRef = useRef<string>("")
  const abortRef = useRef<AbortController | null>(null)
  const aliveRef = useRef(true)
  /** The updatedAt of the parked job the person is answering, so the wait after finish() reads past that old answer. */
  const parkedStampRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const show = useCallback((next: DocumentPhase) => {
    if (aliveRef.current) setPhase(next)
  }, [])

  /** Watches the job of `hash` until it stops and shows where it ended. */
  const watch = useCallback(
    async (hash: string, fileName: string, staleUpdatedAt?: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const job = await waitForJob(client, hash, {
          signal: controller.signal,
          intervalMs: options.intervalMs,
          timeoutMs: options.timeoutMs,
          staleUpdatedAt,
          onState: (j) => show({ kind: "reading", fileName, state: j.state }),
        })
        if (job.state === "created" && job.projectId) {
          forgetJob(hash)
          show({ kind: "created", projectId: job.projectId, job, duplicate: false, fileName })
        } else if (job.state === "rejected") {
          forgetJob(hash)
          const error = job.error
          show({ kind: "failed", message: error?.message ?? "The file was refused.", code: error?.code ?? "rejected", issues: error?.issues ?? [], fileName })
        } else {
          parkedStampRef.current = job.updatedAt
          show({ kind: "parked", job, fileName })
        }
      } catch (error) {
        if (error instanceof DocumentError && error.code === "aborted") return
        show(failureOf(error, fileName))
      }
    },
    [client, options.intervalMs, options.timeoutMs, show],
  )

  const send = useCallback(
    async (file: File, productId: string, hash: string, body: { mode: "prepare" | "create"; name?: string; acknowledgeQuestions?: boolean; acknowledgeShortfall?: boolean }, staleUpdatedAt?: string) => {
      show({ kind: "sending", fileName: file.name })
      try {
        const result = await client.submit({ file, productId, ...body })
        if (result.kind === "duplicate") {
          forgetJob(hash)
          show({ kind: "created", projectId: result.projectId, job: null, duplicate: true, fileName: file.name })
          return
        }
        rememberJob({ sha256: hash, fileName: file.name })
        show({ kind: "reading", fileName: file.name, state: result.state })
        await watch(hash, file.name, staleUpdatedAt)
      } catch (error) {
        show(failureOf(error, file.name))
      }
    },
    [client, show, watch],
  )

  const start = useCallback(
    async ({ file, productId, name, acknowledgeShortfall }: StartInput) => {
      fileRef.current = file
      productRef.current = productId
      setHasFile(true)
      show({ kind: "sending", fileName: file.name })
      let hash: string
      try {
        hash = await client.fingerprint(file)
      } catch (error) {
        show(failureOf(error, file.name))
        return
      }
      if (aliveRef.current) setSha256(hash)
      await send(file, productId, hash, { mode: "prepare", name, acknowledgeShortfall })
    },
    [client, send, show],
  )

  const finish = useCallback(
    async ({ acknowledgeQuestions, acknowledgeShortfall, name, productId }: FinishInput) => {
      if (productId) productRef.current = productId
      const file = fileRef.current
      if (!file || !sha256) {
        show({ kind: "failed", message: "Choose the file again to finish. This page does not keep it.", code: "file_needed", issues: [], fileName: "" })
        return
      }
      await send(file, productRef.current, sha256, { mode: "create", name, acknowledgeQuestions, acknowledgeShortfall }, parkedStampRef.current)
    },
    [send, sha256, show],
  )

  const resume = useCallback(
    async (hash: string, file?: File) => {
      if (aliveRef.current) setSha256(hash)
      if (file) {
        fileRef.current = file
        setHasFile(true)
      }
      const fileName = file?.name ?? ""
      show({ kind: "sending", fileName })
      await watch(hash, fileName)
    },
    [show, watch],
  )

  const supplyFile = useCallback(
    async (file: File, productId: string): Promise<string | null> => {
      let hash: string
      try {
        hash = await client.fingerprint(file)
      } catch {
        return "This file could not be read by the browser."
      }
      if (sha256 && hash !== sha256) return "This is not the file that was sent. Choose the same file again."
      fileRef.current = file
      productRef.current = productId
      if (!sha256 && aliveRef.current) setSha256(hash)
      setHasFile(true)
      return null
    },
    [client, sha256],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    show({ kind: "idle" })
  }, [show])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    fileRef.current = null
    setHasFile(false)
    setSha256(null)
    show({ kind: "idle" })
  }, [show])

  const busy = phase.kind === "sending" || phase.kind === "reading"
  return { phase, busy, sha256, start, finish, resume, supplyFile, hasFile, cancel, reset }
}
