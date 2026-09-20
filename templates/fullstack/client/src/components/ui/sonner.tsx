import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";

/**
 * Toast host, wired to our own ThemeProvider (not `next-themes`, which the
 * upstream scaffold pulled in for this single line of code).
 *
 * Accessibility: toasts are announced via `aria-live`. Sonner handles that;
 * keep `closeButton` enabled so keyboard users can dismiss without waiting.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useTheme();

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      closeButton
      position="bottom-right"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
