"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Modal } from "@/components/ui/modal"

export interface ImageLightboxProps {
  open: boolean
  onClose: () => void
  /** Image URLs, or a single URL. */
  images: string[]
  /** 0-based index of the image to show first. */
  startIndex?: number
  /** Optional caption / accessible label. */
  title?: string
  /** Hide the thumbnail strip and arrows even when there are several images. */
  simple?: boolean
}

/**
 * The one image viewer used everywhere in the app.
 *
 * It is the canonical modal (`ui/modal.tsx`) in bleed mode with a darker
 * backdrop, so opening a photo keeps the same overlay, focus trap, ESC
 * handling and close affordance as every other popup.
 */
export function ImageLightbox({
  open,
  onClose,
  images,
  startIndex = 0,
  title,
  simple = false,
}: ImageLightboxProps) {
  const urls = React.useMemo(
    () => images.filter((url): url is string => Boolean(url)),
    [images]
  )
  const [index, setIndex] = React.useState(startIndex)
  const count = urls.length

  React.useEffect(() => {
    if (open) setIndex(Math.min(Math.max(0, startIndex), Math.max(0, count - 1)))
  }, [open, startIndex, count])

  const go = React.useCallback(
    (delta: number) => {
      if (count <= 1) return
      setIndex((cur) => (cur + delta + count) % count)
    },
    [count]
  )

  React.useEffect(() => {
    if (!open || count <= 1 || simple) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") go(-1)
      if (event.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, count, simple, go])

  const current = urls[index]
  const showNav = !simple && count > 1

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      variant="bleed"
      size="full"
      hideClose
      overlayClassName="bg-black/85 backdrop-blur-md"
      className="border-0 bg-transparent shadow-none"
      bodyClassName="flex-col"
      aria-label={title ? `${title} 圖片預覽` : "圖片預覽"}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50"
        aria-label="關閉"
      >
        <X className="h-5 w-5" />
      </button>

      {current ? (
        <img
          src={current}
          alt={title ?? ""}
          className="max-h-[82vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
        />
      ) : null}

      {showNav ? (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            className="absolute left-4 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="上一張"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            className="absolute right-4 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="下一張"
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          <div className="mt-4 flex max-w-[92vw] items-center justify-center gap-2 overflow-x-auto pb-1">
            {urls.map((url, i) => (
              <button
                key={`${url}-${i}`}
                type="button"
                onClick={() => setIndex(i)}
                className={cn(
                  "h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-opacity",
                  i === index
                    ? "border-white opacity-100"
                    : "border-transparent opacity-50 hover:opacity-80"
                )}
                aria-label={`第 ${i + 1} 張`}
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>

          <p className="mt-2 font-mono-data text-xs text-white/70">
            {index + 1} / {count}
          </p>
        </>
      ) : null}
    </Modal>
  )
}
