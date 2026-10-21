"use client"

import {
  ModalBody,
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
} from "@/components/ui/modal"

/**
 * Compatibility layer for the historic shadcn `Dialog` API.
 *
 * There is now a single modal implementation in the app — `ui/modal.tsx`.
 * These aliases keep older imports working and render exactly the same
 * chrome as every other popup.
 */
const Dialog = ModalRoot
const DialogTrigger = ModalTrigger
const DialogPortal = ModalPortal
const DialogOverlay = ModalOverlay
const DialogClose = ModalClose
const DialogContent = ModalContent
const DialogHeader = ModalHeader
const DialogBody = ModalBody
const DialogFooter = ModalFooter
const DialogTitle = ModalTitle
const DialogDescription = ModalDescription

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
