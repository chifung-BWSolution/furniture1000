"use client"

import * as React from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * The canonical "are you sure?" prompt.
 *
 * Replaces `window.confirm` everywhere: a native confirm blocks the paint,
 * cannot be themed, cannot show rich copy, and on Safari/Chrome inside an
 * iframe it can be suppressed entirely.
 *
 * Usage:
 *   const { confirm, confirmDialog } = useConfirm()
 *   ...
 *   if (!(await confirm({ title: "刪除這筆記錄？" }))) return
 *   ...
 *   return <>{...}{confirmDialog}</>
 */
export interface ConfirmOptions {
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Paints the confirm button in the destructive colour. */
  destructive?: boolean
}

export interface UseConfirmResult {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /** Render this once inside the view that owns the confirm. */
  confirmDialog: React.ReactElement
}

/**
 * Module-level bridge so non-component code (callbacks, effects, lib helpers)
 * can ask for the same dialog without wiring a hook into every view.
 * `ConfirmProvider` is mounted once in AppShell and publishes the dispatcher.
 */
let dispatch: ((options: ConfirmOptions) => Promise<boolean>) | null = null

export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (!dispatch) {
    // Nothing mounted (storybook, tests, pre-auth screens): keep the native
    // prompt instead of silently dropping the question.
    if (typeof window === "undefined") return Promise.resolve(false)
    return Promise.resolve(window.confirm(options.title))
  }
  return dispatch(options)
}

/** Mount once, high in the tree (AppShell). */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { confirm: run, confirmDialog } = useConfirm()

  React.useEffect(() => {
    dispatch = run
    return () => {
      dispatch = null
    }
  }, [run])

  return (
    <>
      {children}
      {confirmDialog}
    </>
  )
}

export function useConfirm(): UseConfirmResult {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null)
  const [open, setOpen] = React.useState(false)
  const resolver = React.useRef<((ok: boolean) => void) | null>(null)

  const settle = React.useCallback((ok: boolean) => {
    setOpen(false)
    const resolve = resolver.current
    resolver.current = null
    resolve?.(ok)
  }, [])

  const confirm = React.useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // A second confirm before the first is answered cancels the first.
        resolver.current?.(false)
        resolver.current = resolve
        setOptions(next)
        setOpen(true)
      }),
    [],
  )

  const confirmDialog = (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false)
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title}</AlertDialogTitle>
          {options?.description ? (
            <AlertDialogDescription className="break-words leading-6">
              {options.description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{options?.cancelLabel ?? "取消"}</AlertDialogCancel>
          <AlertDialogAction
            className={
              options?.destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
            onClick={() => settle(true)}
          >
            {options?.confirmLabel ?? "確定"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirm, confirmDialog }
}
