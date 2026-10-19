import { useEffect, useRef, useState, type ImgHTMLAttributes, type MouseEvent, type ReactNode, type SyntheticEvent } from "react"
import { ImageOff } from "lucide-react"

import { compressStorageDisplayUrl } from "@/lib/imageThumb"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

type LoadingImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onClick"> & {
  src?: string | null
  /** Shown when `src` is empty or the image fails to load. */
  fallback?: ReactNode
  /** Extra classes applied only to the inner img (after object-fit). */
  imgClassName?: string
  onClick?: (event: MouseEvent<HTMLElement>) => void
}

const IMG_TOKEN =
  /^(?:object-(?:contain|cover|fill|none|scale-down)|p[trblxy]?-\S+|select-none|select-auto|transition(?:-\S+)?|duration-\S+|ease-\S+|group-hover:scale-\S+)$/

function splitClassName(className?: string) {
  const tokens = (className ?? "").split(/\s+/).filter(Boolean)
  const imgTokens: string[] = []
  const wrapperTokens: string[] = []
  for (const token of tokens) {
    if (IMG_TOKEN.test(token)) imgTokens.push(token)
    else wrapperTokens.push(token)
  }
  const fit = [...imgTokens].reverse().find((token) => token.startsWith("object-")) ?? "object-cover"
  const imgRest = imgTokens.filter((token) => !token.startsWith("object-")).join(" ")
  const scales = imgTokens.some((token) => token.includes("scale"))
  const wrapper = wrapperTokens.join(" ")
  const sized = /(?:^|\s)(?:h|w|size|aspect|inset)-/.test(` ${wrapper} `)
    || /(?:^|\s)absolute(?:\s|$)/.test(` ${wrapper} `)
  return { wrapper, fit, imgRest, scales, sized, hasClass: tokens.length > 0 }
}

/**
 * Product image with a placeholder until the file has decoded.
 * A sized box (h-/w-/aspect/absolute, or width/height style) fills that box.
 * Lightbox images that only set max-height/max-width keep their intrinsic size;
 * until decode they show a small spinner, never a box that sets the layout height.
 */
function LoadingImage({
  src,
  alt = "",
  className,
  imgClassName,
  fallback,
  style,
  loading,
  decoding = "async",
  onLoad,
  onError,
  onClick,
  ...props
}: LoadingImageProps) {
  const normalized = (src || "").trim()
  const imgRef = useRef<HTMLImageElement>(null)
  const [loadedSrc, setLoadedSrc] = useState("")
  const [failedSrc, setFailedSrc] = useState("")
  const [bypassSrc, setBypassSrc] = useState("")
  const compressed = compressStorageDisplayUrl(normalized, className)
  const requestSrc = bypassSrc === normalized ? normalized : compressed
  const loaded = requestSrc !== "" && loadedSrc === requestSrc
  const failed = requestSrc === "" || failedSrc === requestSrc
  const { wrapper, fit, imgRest, scales, sized, hasClass } = splitClassName(className)
  const styleSized = Boolean(style && (style.width != null || style.height != null))
  const fills = sized || styleSized || !hasClass

  useEffect(() => {
    const img = imgRef.current
    if (!img || !requestSrc) return
    if (!img.complete) return
    if (img.naturalWidth > 0) setLoadedSrc(requestSrc)
    else if (requestSrc !== normalized) setBypassSrc(normalized)
    else setFailedSrc(requestSrc)
  }, [requestSrc, normalized])

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    setLoadedSrc(requestSrc)
    onLoad?.(event)
  }

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    if (requestSrc !== normalized) {
      setBypassSrc(normalized)
      return
    }
    setFailedSrc(requestSrc)
    onError?.(event)
  }

  const image = requestSrc && !failed ? (
    <img
      {...props}
      ref={imgRef}
      src={requestSrc}
      alt={alt}
      loading={loading}
      decoding={decoding}
      onLoad={handleLoad}
      onError={handleError}
      className={
        fills
          ? cn(
              "h-full w-full transition-opacity duration-200",
              fit,
              imgRest,
              loaded ? "opacity-100" : "opacity-0",
              imgClassName,
            )
          : cn(
              className,
              "transition-opacity duration-200",
              loaded ? "opacity-100" : "pointer-events-none absolute h-px w-px opacity-0",
              imgClassName,
            )
      }
    />
  ) : null

  if (!fills) {
    return (
      <span className="relative inline-block max-w-full align-middle" style={style} onClick={onClick}>
        {!loaded && !failed ? (
          <span className="inline-flex size-8 items-center justify-center">
            <Spinner className="size-5 text-muted-foreground/70" />
          </span>
        ) : null}
        {failed ? (
          <span className="inline-flex size-8 items-center justify-center">
            {fallback ?? <ImageOff className="h-5 w-5 text-muted-foreground/40" aria-hidden />}
          </span>
        ) : null}
        {image}
      </span>
    )
  }

  return (
    <span
      className={cn(
        "relative block bg-muted",
        scales ? "overflow-visible" : "overflow-hidden",
        wrapper,
      )}
      style={style}
      aria-busy={!loaded && !failed}
      onClick={onClick}
    >
      {!loaded && !failed ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="absolute inset-0 animate-pulse bg-primary/10" />
          <Spinner className="relative size-4 text-muted-foreground/70" />
        </span>
      ) : null}
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center">
          {fallback ?? <ImageOff className="h-5 w-5 text-muted-foreground/40" aria-hidden />}
        </span>
      ) : null}
      {image}
    </span>
  )
}

export { LoadingImage }
