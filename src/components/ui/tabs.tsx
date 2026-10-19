import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { useReducedMotion } from "framer-motion"

import { cn } from "@/lib/utils"
import { NavInk } from "@/components/motion/NavInk"

const TabsScopeContext = React.createContext("tabs")

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ ...props }, ref) => {
  const uid = React.useId()
  return (
    <TabsScopeContext.Provider value={uid}>
      <TabsPrimitive.Root ref={ref} {...props} />
    </TabsScopeContext.Provider>
  )
})
Tabs.displayName = TabsPrimitive.Root.displayName

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") ref(value)
  else if (ref) ref.current = value
}

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, ...props }, forwardedRef) => {
  const scope = React.useContext(TabsScopeContext)
  const reduceMotion = useReducedMotion()
  const nodeRef = React.useRef<HTMLButtonElement | null>(null)
  const [active, setActive] = React.useState(false)

  const setRef = (node: HTMLButtonElement | null) => {
    nodeRef.current = node
    assignRef(forwardedRef, node)
  }

  React.useLayoutEffect(() => {
    const el = nodeRef.current
    if (!el) return
    const sync = () => setActive(el.getAttribute("data-state") === "active")
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(el, { attributes: true, attributeFilter: ["data-state"] })
    return () => obs.disconnect()
  }, [])

  return (
    <TabsPrimitive.Trigger
      ref={setRef}
      className={cn(
        "relative inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground",
        className
      )}
      {...props}
    >
      {active ? (
        <NavInk
          layoutId={`${scope}-tab-ink`}
          className="absolute inset-0 z-0 rounded-md bg-background shadow"
        />
      ) : null}
      <span
        className={cn(
          "relative z-10 inline-flex items-center justify-center",
          reduceMotion && "transition-none"
        )}
      >
        {children}
      </span>
    </TabsPrimitive.Trigger>
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "tab-panel-in mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
