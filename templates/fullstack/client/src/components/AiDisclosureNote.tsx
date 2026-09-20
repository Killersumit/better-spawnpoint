import { Sparkles } from "lucide-react";
import { Link } from "wouter";
import { ROUTES } from "@shared/const";
import { compliance } from "@shared/compliance";
import { cn } from "@/lib/utils";

/**
 * In-product AI transparency label (EU AI Act Art. 50(1)).
 *
 * Render this alongside any output a model produced, at the moment the user
 * sees it — not buried in a policy page. If you add an AI feature and skip
 * this component, you have a compliance gap, not a design choice.
 *
 * Usage:
 *   <AiDisclosureNote />
 *   <AiDisclosureNote variant="inline" text="Drafted by AI" />
 */
export function AiDisclosureNote({
  variant = "inline",
  text,
  className,
}: {
  variant?: "inline" | "block";
  /** Override the default sentence for a tighter label. */
  text?: string;
  className?: string;
}) {
  if (!compliance.ai.featuresUseAI) return null;

  const label = text ?? "AI-generated — check anything important";

  return (
    <div
      role="note"
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        variant === "block" && "rounded-md border border-border bg-muted/40 p-3",
        className
      )}
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>
        {label}{" "}
        <Link href={ROUTES.aiDisclosure} className="underline underline-offset-2">
          How AI is used here
        </Link>
        {compliance.ai.providerUrl && (
          <>
            {" · "}
            <a
              href={compliance.ai.providerUrl}
              className="underline underline-offset-2"
              rel="noopener noreferrer"
              target="_blank"
            >
              {compliance.ai.providerLabel}
            </a>
          </>
        )}
      </span>
    </div>
  );
}
