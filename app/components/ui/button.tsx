import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "~/lib/utils"

const buttonVariants = cva(
  // Base: pill shape, 14px/500, consistent focus ring, transitions
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Black pill — dominant CTA
        default:
          "bg-primary text-primary-foreground hover:bg-primary/85",
        // Brand-yellow pill — brand emphasis moments
        yellow:
          "bg-brand-yellow text-primary hover:bg-brand-yellow-deep",
        // Brand-blue pill — inline action callouts
        blue:
          "bg-brand-blue text-white hover:bg-blue-pressed",
        // Outline pill — secondary actions
        outline:
          "border border-hairline-strong bg-transparent text-ink hover:bg-surface",
        // Same as outline (kept for shadcn compat)
        secondary:
          "border border-hairline-strong bg-transparent text-ink hover:bg-surface",
        // White pill — for use on dark backgrounds
        "on-dark":
          "bg-on-dark text-primary hover:bg-on-dark/90",
        // Quiet rectangular ghost — not a pill
        ghost:
          "rounded-md bg-transparent text-ink hover:bg-surface",
        // Inline text link
        link:
          "rounded-none h-auto p-0 text-brand-blue underline-offset-4 hover:underline",
        // Destructive — red pill
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/30",
      },
      size: {
        default: "h-11 px-6 py-3 has-[>svg]:px-4",
        sm:      "h-9  px-4 py-2 has-[>svg]:px-3",
        lg:      "h-12 px-8     has-[>svg]:px-6",
        xs:      "h-7  px-3     text-xs has-[>svg]:px-2",
        icon:    "size-11",
        "icon-sm": "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
