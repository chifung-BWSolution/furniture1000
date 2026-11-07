"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { NavInk } from "@/components/motion/NavInk"

export interface ViewModeOption<TValue extends string> {
  value: TValue
  label: string
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
}

/**
 * Segmented view switch: one shared pill travels between the options instead of
 * each option fading its own background in place. Keyboard follows the tab
 * pattern (arrow keys, Home/End, roving tabindex).
 */
export function ViewModeSwitch<TValue extends string>({
  value,
  onChange,
  options,
  label,
  panelId,
  className,
}: {
  value: TValue
  onChange: (value: TValue) => void
  options: ReadonlyArray<ViewModeOption<TValue>>
  label: string
  /** id of the region these tabs control; it should carry role="tabpanel". */
  panelId?: string
  className?: string
}) {
  const scope = React.useId()
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const activeIndex = options.findIndex((option) => option.value === value)

  const select = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    itemRefs.current[index]?.focus()
  }

  const onKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const last = options.length - 1
    let next: number
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = index === last ? 0 : index + 1
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = index === 0 ? last : index - 1
    } else if (event.key === "Home") {
      next = 0
    } else if (event.key === "End") {
      next = last
    } else {
      return
    }
    event.preventDefault()
    select(next)
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-0.5 rounded-full border border-input bg-muted/40 p-0.5",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            ref={(node) => {
              itemRefs.current[index] = node
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            id={`${scope}-${option.value}`}
            tabIndex={selected || (activeIndex < 0 && index === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "relative inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              selected
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {selected ? (
              <NavInk
                layoutId={`${scope}-view-mode-ink`}
                className="absolute inset-0 rounded-full bg-background shadow-sm"
              />
            ) : null}
            <span className="relative z-10 inline-flex items-center gap-1.5 whitespace-nowrap">
              {Icon ? (
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              ) : null}
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
