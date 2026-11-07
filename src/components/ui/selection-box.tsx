"use client"

import * as React from "react"
import { animate, useReducedMotion } from "framer-motion"

import { cn } from "@/lib/utils"

export type SelectionHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

const HANDLES: SelectionHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

/**
 * Handle glyph geometry, in the 30×30 viewBox the handle is drawn in. The square
 * and the double-headed arrow share the same vertex count, so one can be morphed
 * into the other by interpolating each point.
 */
const SQUARE: ReadonlyArray<readonly [number, number]> = [
  [-5, 0], [-5, -5], [-2.5, -5], [2.5, -5], [5, -5],
  [5, 0], [5, 5], [2.5, 5], [-2.5, 5], [-5, 5],
]
const ARROW: ReadonlyArray<readonly [number, number]> = [
  [-11, 0], [-4, -7], [-4, -3], [4, -3], [4, -7],
  [11, 0], [4, 7], [4, 3], [-4, 3], [-4, 7],
]

/** Arrow rotation per handle, so the arrow points the way the edge grows. */
const ROTATION: Record<SelectionHandle, number> = {
  nw: 45, n: 90, ne: -45, e: 0, se: 45, s: 90, sw: -45, w: 0,
}

const CURSOR: Record<SelectionHandle, string> = {
  nw: "nwse-resize", se: "nwse-resize",
  ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize",
  e: "ew-resize", w: "ew-resize",
}

const HANDLE_LABEL: Record<SelectionHandle, string> = {
  nw: "左上", n: "上", ne: "右上", e: "右",
  se: "右下", s: "下", sw: "左下", w: "左",
}

/** Handle anchor inside the box, in percent. */
const ANCHOR: Record<SelectionHandle, { x: number; y: number }> = {
  nw: { x: 0, y: 0 }, n: { x: 50, y: 0 }, ne: { x: 100, y: 0 },
  w: { x: 0, y: 50 }, e: { x: 100, y: 50 },
  sw: { x: 0, y: 100 }, s: { x: 50, y: 100 }, se: { x: 100, y: 100 },
}

function handlePoints(handle: SelectionHandle, morph: number): string {
  const angle = (ROTATION[handle] * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return SQUARE.map((square, index) => {
    const arrow = ARROW[index]
    const ax = arrow[0] * cos - arrow[1] * sin
    const ay = arrow[0] * sin + arrow[1] * cos
    const x = square[0] + (ax - square[0]) * morph
    const y = square[1] + (ay - square[1]) * morph
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(" ")
}

/**
 * A single resize handle. The square glyph continuously becomes a directional
 * arrow when the handle is hovered, focused or dragged.
 */
function ResizeHandle({
  handle,
  color,
  emphasized,
  disabled,
  onPointerDown,
  onKeyDown,
  onHoverChange,
}: {
  handle: SelectionHandle
  color: string
  emphasized: boolean
  disabled?: boolean
  onPointerDown?: (handle: SelectionHandle, event: React.PointerEvent<HTMLButtonElement>) => void
  onKeyDown?: (handle: SelectionHandle, event: React.KeyboardEvent<HTMLButtonElement>) => void
  onHoverChange?: (handle: SelectionHandle, hovered: boolean) => void
}) {
  const glyph = React.useRef<SVGPolygonElement>(null)
  const morph = React.useRef(0)
  const reduceMotion = useReducedMotion()
  const anchor = ANCHOR[handle]

  React.useEffect(() => {
    const target = emphasized ? 1 : 0
    if (reduceMotion) {
      morph.current = target
      glyph.current?.setAttribute("points", handlePoints(handle, target))
      return
    }
    const controls = animate(morph.current, target, {
      duration: 0.22,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (value) => {
        morph.current = value
        glyph.current?.setAttribute("points", handlePoints(handle, value))
      },
    })
    return () => controls.stop()
  }, [emphasized, handle, reduceMotion])

  const position: React.CSSProperties = {
    left: `${anchor.x}%`,
    top: `${anchor.y}%`,
    cursor: CURSOR[handle],
  }

  return (
    <button
      type="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={`調整大小：${HANDLE_LABEL[handle]}`}
      aria-disabled={disabled || undefined}
      data-selection-handle={handle}
      className={cn(
        "pointer-events-auto absolute z-[4] h-[30px] w-[30px] -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-0 bg-transparent p-0 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        disabled && "pointer-events-none opacity-0",
      )}
      style={position}
      onPointerDown={(event) => {
        if (disabled) return
        event.stopPropagation()
        // Keep the handle focused so arrow-key nudging works right after a drag.
        event.currentTarget.focus({ preventScroll: true })
        onPointerDown?.(handle, event)
      }}
      onPointerEnter={() => onHoverChange?.(handle, true)}
      onPointerLeave={() => onHoverChange?.(handle, false)}
      onFocus={() => onHoverChange?.(handle, true)}
      onBlur={() => onHoverChange?.(handle, false)}
      onKeyDown={(event) => onKeyDown?.(handle, event)}
    >
      <svg viewBox="-15 -15 30 30" aria-hidden="true" className="pointer-events-none block h-[30px] w-[30px] overflow-visible">
        <polygon
          ref={glyph}
          points={handlePoints(handle, 0)}
          fill="#ffffff"
          stroke={color}
          strokeWidth={0.9}
          strokeLinejoin="miter"
          style={{ paintOrder: "stroke fill" }}
        />
      </svg>
    </button>
  )
}

/**
 * Resizable selection frame in the LeiBox "bounding box" style: dashed outline,
 * eight handles that morph into arrows, live size pills and edge guides.
 *
 * The frame itself ignores pointer events so the parent keeps owning drag / move
 * / draw on the canvas underneath; only the handles are interactive.
 */
export function SelectionBox({
  x,
  y,
  w,
  h,
  color = "hsl(var(--primary))",
  active = false,
  disabled = false,
  draggingHandle = null,
  sizeText,
  onHandlePointerDown,
  onHandleKeyDown,
  ariaLabel,
  className,
  style,
  children,
}: {
  /** Rect in percentages of the parent box. */
  x: number
  y: number
  w: number
  h: number
  color?: string
  active?: boolean
  disabled?: boolean
  /** Handle currently being dragged by the parent. */
  draggingHandle?: SelectionHandle | null
  /** Live size readout, shown in pills next to the active handle. */
  sizeText?: { width: string; height: string } | null
  onHandlePointerDown?: (handle: SelectionHandle, event: React.PointerEvent<HTMLButtonElement>) => void
  onHandleKeyDown?: (handle: SelectionHandle, event: React.KeyboardEvent<HTMLButtonElement>) => void
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}) {
  const [hovered, setHovered] = React.useState<SelectionHandle | null>(null)
  const focusHandle = draggingHandle ?? hovered
  const showWidth = Boolean(sizeText) && !!focusHandle && (focusHandle.includes("w") || focusHandle.includes("e"))
  const showHeight = Boolean(sizeText) && !!focusHandle && (focusHandle.includes("n") || focusHandle.includes("s"))
  const edgeGuide = focusHandle === "w" || focusHandle === "e"
    ? "horizontal"
    : focusHandle === "n" || focusHandle === "s"
      ? "vertical"
      : null
  const anchor = focusHandle ? ANCHOR[focusHandle] : null

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("pointer-events-none absolute z-[1] box-border", className)}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${w}%`,
        height: `${h}%`,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: color, opacity: active ? 0.18 : 0.1 }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{ border: `1.5px dashed ${color}`, boxShadow: "0 0 0 1px rgba(255,255,255,0.55)" }}
      />
      {edgeGuide ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute opacity-45",
            edgeGuide === "horizontal"
              ? "inset-x-0 top-1/2 border-t border-dashed"
              : "inset-y-0 left-1/2 border-l border-dashed",
          )}
          style={{ borderColor: color }}
        />
      ) : null}
      {children}
      {disabled
        ? null
        : HANDLES.map((handle) => (
            <ResizeHandle
              key={handle}
              handle={handle}
              color={color}
              emphasized={focusHandle === handle}
              disabled={disabled}
              onPointerDown={onHandlePointerDown}
              onKeyDown={onHandleKeyDown}
              onHoverChange={(key, isHovered) => setHovered((current) => (isHovered ? key : current === key ? null : current))}
            />
          ))}
      {showWidth && anchor && sizeText ? (
        <span
          aria-hidden="true"
          className="absolute z-[5] flex h-[18px] -translate-x-1/2 -translate-y-1/2 items-center rounded-full px-1.5 text-[11px] font-semibold leading-none tabular-nums text-white shadow-sm"
          style={{
            left: `calc(${anchor.x}% ${focusHandle?.includes("w") ? "+" : "-"} 32px)`,
            top: `${anchor.y}%`,
            background: color,
          }}
        >
          {sizeText.width}
        </span>
      ) : null}
      {showHeight && anchor && sizeText ? (
        <span
          aria-hidden="true"
          className="absolute z-[5] flex h-[18px] -translate-x-1/2 -translate-y-1/2 items-center rounded-full px-1.5 text-[11px] font-semibold leading-none tabular-nums text-white shadow-sm"
          style={{
            left: `${anchor.x}%`,
            top: `calc(${anchor.y}% ${focusHandle?.includes("n") ? "+" : "-"} 25px)`,
            background: color,
          }}
        >
          {sizeText.height}
        </span>
      ) : null}
    </div>
  )
}
