import { cn } from "~/lib/utils";

type NativeSelectProps = React.ComponentProps<"select"> & {
  size?: "default" | "sm";
  wrapperClassName?: string;
};

function SelectChevron() {
  return (
    <svg
      className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400"
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
          "select-native w-full rounded-lg border border-slate-200 bg-white px-3 text-slate-900",
          "focus:outline-none focus:ring-2 focus:ring-slate-900 transition",
          "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
          size === "sm" ? "h-9 text-xs" : "h-10 text-sm",
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
