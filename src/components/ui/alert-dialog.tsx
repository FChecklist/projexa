"use client"

import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

// R52 GATE 2 -- SAME ROOT CAUSE AS src/components/ui/dialog.tsx, EXTENDED HERE.
//
// dialog.tsx (see its DialogOverlay comment for the full derivation) removed
// the exit-animation utilities from its Presence-gated portal nodes. Radix
// Presence unmounts such a node immediately ONLY when the computed
// animation-name is `none`; with an exit animation present it enters
// unmountSuspended and waits for `animationend` FOREVER, with no timeout
// fallback. One dropped frame -- a backgrounded or occluded tab -- and the
// node is stranded permanently.
//
// That fix was applied to dialog/sheet/drawer only, but every Radix layer in
// this directory is gated by the same Presence. The MODAL ones are the
// dangerous ones: while a layer is open Radix's DismissableLayer sets
// `document.body.style.pointerEvents = "none"` and RemoveScroll holds
// non-passive wheel/touchmove listeners plus a refcounted `data-scroll-locked`
// attribute on <body>. A stranded node never runs its cleanup, so the body
// stays pointer-events:none: from then on EVERY control on the page is inert
// -- buttons, plain <a href> links, even focusing a bare <input> -- with no
// console error and no network request, which is exactly the shape of the
// dead-control faults filed against this app (F_035 /rfis, F_036 /quotations,
// F_037 /sales, F_011 /permits/[id], F_009 /permits/new). Those pages' own
// handlers were read and are correctly wired; nothing on the page could
// produce that symptom.
//
// With the exit utilities gone the computed animation-name is `none` on close,
// Presence takes its immediate branch, and the node, the RemoveScroll
// listeners and the body attribute all come down in the same commit. Cost is
// the close fade. The OPEN animation is untouched -- it is not gated on
// anything. The `!pointer-events-none` guard is defence in depth and carries
// `!` deliberately: Radix writes `pointer-events: auto` as an INLINE style on
// these nodes, which beats any non-important author rule.

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:!pointer-events-none data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:!pointer-events-none data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants(), className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
