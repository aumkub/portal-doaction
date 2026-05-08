import * as React from "react"

import { cn } from "~/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // 44px height, 8px radius, hairline-strong border
        "h-11 w-full min-w-0 rounded-md border border-hairline-strong bg-canvas px-3 py-2.5 text-sm text-ink shadow-none transition-[color,box-shadow] outline-none",
        "placeholder:text-stone",
        "selection:bg-brand-blue selection:text-white",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        // Focus: brand-blue border + soft ring
        "focus-visible:border-brand-blue focus-visible:ring-[3px] focus-visible:ring-brand-blue/15",
        // Error state
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
