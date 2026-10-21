"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The single, canonical modal used by every popup in the app.
 *
 * Visual reference (the "generic modal" spec):
 *   - dark blurred backdrop
 *   - rounded white card
 *   - optional lavender circle icon + bold title + muted description
 *   - scrollable body
 *   - hairline-separated footer, actions right aligned
 *     (primary -> secondary -> cancel)
 *
 * Built on Radix Dialog so every modal keeps focus trapping, ESC handling,
 * scroll locking and portal rendering for free.
 */

export type ModalSize =
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "4xl"
  | "5xl"
  | "full"

const MODAL_SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  full: "max-w-[95vw]",
}

/** Raw Radix root — used by the `Dialog` compatibility layer and by triggers. */
const ModalRoot = DialogPrimitive.Root

const ModalTrigger = DialogPrimitive.Trigger

const ModalPortal = DialogPrimitive.Portal

const ModalClose = DialogPrimitive.Close

const ModalOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
ModalOverlay.displayName = DialogPrimitive.Overlay.displayName

const modalIconClass = (size: "sm" | "md" | "lg"): string =>
  size === "sm"
    ? "h-10 w-10 [&_svg]:h-5 [&_svg]:w-5"
    : size === "lg"
      ? "h-14 w-14 [&_svg]:h-7 [&_svg]:w-7"
      : "h-12 w-12 [&_svg]:h-6 [&_svg]:w-6"

const ModalHeader = ({
  className,
  icon,
  iconSize = "md",
  aside,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  icon?: React.ReactNode
  iconSize?: "sm" | "md" | "lg"
  /** Optional slot pinned to the right edge of the header (e.g. a live percentage). */
  aside?: React.ReactNode
}) => (
  <div
    className={cn(
      "flex items-start gap-3.5 px-5 pt-5 pb-4 sm:px-6 sm:pt-6 sm:pb-5",
      className
    )}
    {...props}
  >
    {icon ? (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary",
          modalIconClass(iconSize)
        )}
      >
        {icon}
      </span>
    ) : null}
    <div className="min-w-0 flex-1 space-y-1">{children}</div>
    {aside ? (
      <div className="shrink-0 self-center pl-2">{aside}</div>
    ) : null}
  </div>
)
ModalHeader.displayName = "ModalHeader"

const ModalTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-bold leading-snug tracking-tight text-foreground sm:text-xl",
      className
    )}
    {...props}
  />
))
ModalTitle.displayName = DialogPrimitive.Title.displayName

const ModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn(
      "text-sm leading-relaxed text-muted-foreground",
      className
    )}
    {...props}
  />
))
ModalDescription.displayName = DialogPrimitive.Description.displayName

const ModalBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("min-h-0 flex-1 overflow-y-auto", className)} {...props} />
)
ModalBody.displayName = "ModalBody"

const ModalFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse items-stretch gap-2 border-t border-border bg-muted/20 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-end sm:gap-2.5 sm:px-6 sm:py-4",
      className
    )}
    {...props}
  />
)
ModalFooter.displayName = "ModalFooter"

export const modalButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98]",
        secondary:
          "border border-input bg-background text-foreground shadow-sm hover:bg-muted active:scale-[0.98]",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:scale-[0.98]",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-9 rounded-lg px-4 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10 px-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

export interface ModalButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof modalButtonVariants> {
  asChild?: boolean
}

const ModalButton = React.forwardRef<HTMLButtonElement, ModalButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref}
        type={asChild ? type : (type ?? "button")}
        className={cn(modalButtonVariants({ variant, size }), className)}
        {...props}
      />
    )
  }
)
ModalButton.displayName = "ModalButton"

export type ModalContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  "title"
> & {
  /** Bold heading of the modal. */
  title?: React.ReactNode
  /** Muted supporting copy under the heading. */
  description?: React.ReactNode
  /** Rendered inside a lavender circle to the left of the heading. */
  icon?: React.ReactNode
  /** Optional slot pinned to the right edge of the header (e.g. a live percentage). */
  headerAside?: React.ReactNode
  size?: ModalSize
  /** Actions rendered inside the separated footer bar, right aligned. */
  footer?: React.ReactNode
  hideClose?: boolean
  /**
   * `card` is the standard chrome (icon + title + body + footer).
   * `bleed` drops the padding so the body can host a full-bleed surface
   * (image viewer, PDF preview) while keeping the same card + backdrop.
   */
  variant?: "card" | "bleed"
  headerClassName?: string
  bodyClassName?: string
  footerClassName?: string
  /** Override the backdrop surface (lightboxes usually go darker). */
  overlayClassName?: string
}

const ModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(
  (
    {
      className,
      children,
      title,
      description,
      icon,
      headerAside,
      size = "md",
      footer,
      hideClose,
      variant = "card",
      headerClassName,
      bodyClassName,
      footerClassName,
      overlayClassName,
      ...props
    },
    ref
  ) => {
    const bleed = variant === "bleed"
    const hasHeader = Boolean(title || description || icon)
    const hasBody =
      children !== undefined && children !== null && children !== false
    const iconSize: "sm" | "md" | "lg" =
      size === "sm" || size === "md"
        ? "sm"
        : size === "lg" || size === "xl"
          ? "md"
          : "lg"

    return (
      <ModalPortal>
        <ModalOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 flex max-h-[92vh] w-full -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-2xl duration-200",
            MODAL_SIZE_CLASS[size],
            "rounded-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
            className
          )}
          {...props}
        >
          {hasHeader ? (
            <ModalHeader
              icon={icon}
              iconSize={iconSize}
              aside={headerAside}
              className={headerClassName}
            >
              {title != null ? <ModalTitle>{title}</ModalTitle> : null}
              {description != null ? (
                <ModalDescription>{description}</ModalDescription>
              ) : null}
            </ModalHeader>
          ) : (
            <DialogPrimitive.Title className="sr-only">Dialog</DialogPrimitive.Title>
          )}

          {hasBody ? (
            <ModalBody
              className={cn(
                bleed
                  ? "flex items-center justify-center"
                  : cn(
                      "px-5 pb-5 sm:px-6 sm:pb-6",
                      !hasHeader && "pt-5 sm:pt-6"
                    ),
                bodyClassName
              )}
            >
              {children}
            </ModalBody>
          ) : null}

          {footer ? (
            <ModalFooter className={footerClassName}>{footer}</ModalFooter>
          ) : null}

          {!hideClose ? (
            <DialogPrimitive.Close className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:pointer-events-none">
              <X className="h-4 w-4" />
              <span className="sr-only">關閉</span>
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Content>
      </ModalPortal>
    )
  }
)
ModalContent.displayName = DialogPrimitive.Content.displayName

export type ModalProps = ModalContentProps &
  Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>, "children"> & {
    children?: React.ReactNode
  }

/**
 * The generic modal. Renders the backdrop, the card chrome and (optionally)
 * the icon / title / description header and the action footer.
 */
const Modal = ({
  open,
  defaultOpen,
  onOpenChange,
  modal,
  children,
  ...contentProps
}: ModalProps) => (
  <DialogPrimitive.Root
    open={open}
    defaultOpen={defaultOpen}
    onOpenChange={onOpenChange}
    modal={modal}
  >
    <ModalContent {...contentProps}>{children}</ModalContent>
  </DialogPrimitive.Root>
)
Modal.displayName = "Modal"

export {
  Modal,
  ModalRoot,
  ModalPortal,
  ModalOverlay,
  ModalTrigger,
  ModalClose,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalTitle,
  ModalDescription,
  ModalButton,
}
