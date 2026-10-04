import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "~/lib/utils"

const badgeVariants = cva(
  // Base: pill, caption-bold (13px/600), consistent padding
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-transparent whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        // Dark navy — primary status
        default:
          "bg-ink text-white ring-ink",
        // Soft yellow tag chip — feature highlights
        yellow:
          "bg-[#FFF6C2] text-[#6B5B00] ring-transparent",
        // Promo / brand yellow — announcements
        promo:
          "bg-brand-yellow text-ink ring-transparent",
        // Lavender — AI / featured / blue tags
        purple:
          "bg-sky-50 text-sky-700 ring-transparent",
        // Coral tag
        coral:
          "bg-[#FDE7DA] text-[#B4541A] ring-transparent",
        // Success / confirmation
        success:
          "bg-emerald-50 text-emerald-700 ring-transparent",
        // Error / destructive
        destructive:
          "bg-[#FDE7DA] text-[#B4541A] ring-transparent",
        // Neutral outline
        outline:
          "bg-white text-ink-soft ring-line",
        // Quiet surface
        secondary:
          "bg-paper text-muted-ink ring-transparent",
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
