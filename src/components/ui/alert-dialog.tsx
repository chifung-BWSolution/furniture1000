"use client"

import * as React from "react"

import {
  ModalButton,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalPortal,
  ModalRoot,
  ModalTitle,
  ModalTrigger,
  type ModalButtonProps,
} from "@/components/ui/modal"
import { cn } from "@/lib/utils"

/**
 * Compatibility layer for the historic shadcn `AlertDialog` API.
 *
 * Destructive confirmations in this app now use the same modal shell as every
 * other popup (`ui/modal.tsx`), so a confirmation dialog looks identical to a
 * form dialog. `AlertDialogAction` / `AlertDialogCancel` keep working and
 * still close the dialog when clicked.
 */
const AlertDialog = ModalRoot
const AlertDialogTrigger = ModalTrigger
const AlertDialogPortal = ModalPortal
const AlertDialogOverlay = ModalOverlay
const AlertDialogContent = ModalContent
const AlertDialogTitle = ModalTitle
const AlertDialogDescription = ModalDescription

/**
 * Confirmations render `<AlertDialogHeader>` / `<AlertDialogFooter>` as
 * children of `AlertDialogContent`, whose card body already carries the
 * padding. So the header drops its own padding, and the footer bleeds to the
 * card edges (same full-width band as ModalContent's built-in footer) instead
 * of floating inset with double padding.
 */
const AlertDialogHeader = ({ className, ...props }: React.ComponentProps<typeof ModalHeader>) => (
  <ModalHeader className={cn("p-0 pr-10 sm:p-0 sm:pr-10", className)} {...props} />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

const AlertDialogFooter = ({ className, ...props }: React.ComponentProps<typeof ModalFooter>) => (
  <ModalFooter
    className={cn("-mx-5 -mb-5 mt-5 sm:-mx-6 sm:-mb-6 sm:mt-6", className)}
    {...props}
  />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

const AlertDialogAction = React.forwardRef<HTMLButtonElement, ModalButtonProps>(
  ({ className, ...props }, ref) => (
    <ModalClose asChild>
      <ModalButton ref={ref} className={className} {...props} />
    </ModalClose>
  )
)
AlertDialogAction.displayName = "AlertDialogAction"

const AlertDialogCancel = React.forwardRef<HTMLButtonElement, ModalButtonProps>(
  ({ className, ...props }, ref) => (
    <ModalClose asChild>
      <ModalButton
        ref={ref}
        variant="secondary"
        className={className}
        {...props}
      />
    </ModalClose>
  )
)
AlertDialogCancel.displayName = "AlertDialogCancel"

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
