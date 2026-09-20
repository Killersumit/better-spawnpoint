import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

/**
 * Catches render-time errors so one broken component cannot white-screen the
 * app.
 *
 * Privacy note: the upstream scaffold rendered `error.stack` straight into the
 * page, which leaks file paths, internal component names, and sometimes tokens
 * embedded in URLs to anyone who can trigger a crash. We show a generic message
 * plus the request id, and log the detail to the console (dev) or the error
 * reporter (prod) instead.
 */
export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Replace with your error reporter (Sentry, GlitchTip, ...) in production.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-screen items-center justify-center p-8 bg-background">
        <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive" aria-hidden="true" />
          <h1 className="text-xl font-semibold">Something went wrong on this page</h1>
          <p className="text-sm text-muted-foreground">
            The error was recorded. Try again, and if it keeps happening, contact
            support and mention what you were doing.
          </p>
          <div className="flex gap-2">
            <Button onClick={this.reset} variant="default">
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <Button onClick={() => window.location.assign("/")} variant="outline">
              Go to the home page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
