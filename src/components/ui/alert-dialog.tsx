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
const AlertDialogHeader = ModalHeader
const AlertDialogFooter = ModalFooter
const AlertDialogTitle = ModalTitle
const AlertDialogDescription = ModalDescription

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
