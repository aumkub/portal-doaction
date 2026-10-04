import { cn } from "~/lib/utils";

type NativeSelectProps = React.ComponentProps<"select"> & {
  size?: "default" | "sm";
  wrapperClassName?: string;
};

function SelectChevron() {
  return (
    <svg
      className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-faint-ink"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <path
        d="M2.5 4.5 6 8 9.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NativeSelect({
  className,
  wrapperClassName,
  size = "default",
  disabled,
  children,
  ...props
}: NativeSelectProps) {
  return (
    <div className={cn("relative w-full", wrapperClassName)}>
      <select
        disabled={disabled}
        className={cn(
          // appearance-none hides the browser arrow; SelectChevron draws the only one.
          "select-native w-full appearance-none rounded-xl border border-line bg-white pl-3.5 pr-9 text-ink",
          "focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition",
          "disabled:cursor-not-allowed disabled:bg-paper disabled:text-muted-ink",
          size === "sm" ? "h-8 text-xs" : "h-10 text-sm",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <SelectChevron />
    </div>
  );
}
