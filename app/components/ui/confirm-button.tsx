import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

type Props = Omit<ComponentProps<"button">, "type" | "onClick"> & {
  /** Question shown in the dialog. */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/**
 * A submit button that asks first, in an in-page dialog. Native
 * `window.confirm` is unreliable: embedded browsers (and some extensions)
 * return false without showing anything, which silently cancels the action.
 *
 * Place it inside a <Form>; `name`/`value` are kept on the real submitter so
 * the action sees the same fields as a plain submit button.
 */
export function ConfirmButton({
  message,
  confirmLabel = "ยืนยัน",
  cancelLabel = "ยกเลิก",
  destructive = false,
  children,
  name,
  value,
  ...buttonProps
}: Props) {
  const [open, setOpen] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button type="button" {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </button>
      <button ref={submitRef} type="submit" name={name} value={value} hidden />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmLabel}?</DialogTitle>
            <DialogDescription className="text-sm text-muted-ink">{message}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              onClick={() => {
                setOpen(false);
                submitRef.current?.click();
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
