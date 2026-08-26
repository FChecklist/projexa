"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        // R52 fix for R48_DIALOG_CLOSE_LEAK_01. THE R46 F_007 GUARD BELOW THIS
        // LINE WAS INERT, AND SAYING SO MATTERS: the next auditor would
        // otherwise read the old comment and mark this fault already
        // mitigated. `data-[state=closed]:pointer-events-none` emits a
        // specificity-(0,2,0) author rule, but Radix writes
        // `pointer-events: auto` as an INLINE STYLE on this same node
        // (@radix-ui/react-dialog dist/index.mjs:116, and
        // react-dismissable-layer dist/index.mjs:145 for the content node).
        // Inline beats any non-!important author rule, so the guard never
        // took effect.
        //
        // ROOT CAUSE, which the guard was only ever papering over: Radix
        // Presence unmounts this node immediately ONLY when the computed
        // animation-name is `none`. With an exit animation present it goes to
        // unmountSuspended and waits for `animationend` -- FOREVER, with no
        // timeout fallback. One dropped frame (backgrounded or occluded tab)
        // and the node is stranded permanently. That matters far beyond
        // clicks: Radix wraps the overlay in RemoveScroll, which holds
        // non-passive wheel/touchmove listeners that preventDefault and a
        // refcounted `data-scroll-locked` attribute on <body>. Never
        // unmounted means PAGE SCROLL IS DEAD until a reload -- which is
        // exactly the reported symptom, and which no pointer-events guard
        // could ever have fixed.
        //
        // THE FIX: drop the exit-animation utilities. With computed
        // animation-name `none` on close, Presence takes its explicit
        // immediate branch and the node, the RemoveScroll listeners and the
        // body attribute all come down synchronously in the same commit.
        // Cost is the ~150ms close fade. The OPEN path keeps its animation --
        // it is not gated on anything.
        //
        // The pointer-events guard is kept as defence in depth and given `!`
        // so it can actually beat the inline style if a node is ever stranded
        // some other way.
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:!pointer-events-none fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // R52: same change as DialogOverlay above -- see that comment for
          // the root cause. The exit animation is what stranded this node;
          // the pointer-events guard alone was inert against Radix's inline
          // style, and would not have released the scroll lock even if it
          // had worked.
          "bg-background data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:!pointer-events-none fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
