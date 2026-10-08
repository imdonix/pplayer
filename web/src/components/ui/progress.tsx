import * as ProgressPrimitive from "@radix-ui/react-progress"
import type * as React from "react"
import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const indeterminate = value == null
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-primary/20", className)}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full w-full flex-1 bg-primary transition-transform",
          indeterminate && "w-1/3 animate-indeterminate transition-none",
        )}
        style={
          indeterminate
            ? undefined
            : { transform: `translateX(-${100 - Math.min(100, Math.max(0, value))}%)` }
        }
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
