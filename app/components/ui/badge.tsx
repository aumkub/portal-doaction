import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "~/lib/utils"

const badgeVariants = cva(
  // Base: pill, caption-bold (13px/600), consistent padding
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        // Dark navy — primary status
        default:
          "bg-primary text-primary-foreground",
        // Soft yellow tag chip — feature highlights
        yellow:
          "bg-yellow-light text-yellow-dark",
        // Promo / brand yellow — announcements
        promo:
          "bg-brand-yellow text-primary",
        // Lavender — AI / featured / blue tags
        purple:
          "bg-surface-pricing-featured text-brand-blue",
        // Coral tag
        coral:
          "bg-coral-light text-coral-dark",
        // Success / confirmation
        success:
          "bg-success-accent text-white",
        // Error / destructive
        destructive:
          "bg-brand-red text-brand-red-dark border border-brand-red-dark/20",
        // Neutral outline
        outline:
          "border-hairline text-ink",
        // Quiet surface
        secondary:
          "bg-surface text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
