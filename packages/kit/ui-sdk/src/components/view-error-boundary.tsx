import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { RetryableError } from "../lib/kept-load";
import { logError } from "../lib/log";
import { isMissingChunk, reloadForNewBuild } from "../lib/stale-build";

export interface ViewErrorProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/** Recovery UI for a crashed lazy view — keeps surrounding chrome usable. */
export function ViewError({
  title = "This view crashed",
  message = "Something went wrong while rendering. The rest of kb is still available.",
  onRetry,
  className,
}: ViewErrorProps) {
  return (
    <div
      role="alert"
      data-testid="view-error"
      className={cn("flex h-full min-h-0 flex-col items-start justify-center gap-3 p-6", className)}
    >
      <h2 className="text-ui font-medium text-foreground/80">{title}</h2>
      <p className="max-w-md text-ui text-foreground/50">{message}</p>
      {onRetry ? (
        <button
          type="button"
          data-testid="view-error-retry"
          onClick={onRetry}
          className="rounded-md border border-foreground/10 bg-foreground/[0.04] px-3 py-1.5 text-meta text-foreground/70 transition-colors hover:bg-foreground/[0.08] hover:text-foreground/85"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

interface ViewErrorBoundaryProps {
  children: ReactNode;
  /** Reset error state when this key changes (e.g. route id). */
  resetKey?: string;
  title?: string;
  fallback?: ReactNode;
}

interface ViewErrorBoundaryState {
  error: Error | null;
  /** The error is a chunk of an older build, and the page is reloading for the new one. */
  updating: boolean;
  /** Last `resetKey` folded into state, so a change to it clears the error. */
  resetKey: string | undefined;
}

/**
 * Localized boundary for a lazily loaded view's chunk.
 * Shell chrome (sidebar, header, palette) stays outside this tree.
 */
export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  override state: ViewErrorBoundaryState = { error: null, updating: false, resetKey: undefined };

  static getDerivedStateFromError(
    error: Error,
  ): Pick<ViewErrorBoundaryState, "error" | "updating"> {
    return { error, updating: isMissingChunk(error) };
  }

  static getDerivedStateFromProps(
    props: ViewErrorBoundaryProps,
    state: ViewErrorBoundaryState,
  ): ViewErrorBoundaryState | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, updating: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // A view of a build the server no longer has is not a crash: the page
    // reloads into the new one (`lib/stale-build`). When this build was
    // reloaded for already, the failure is shown as one.
    if (reloadForNewBuild(error)) return;
    if (this.state.updating) this.setState({ updating: false });
    logError("ViewErrorBoundary caught", error, info.componentStack);
  }

  private retry = (): void => {
    // A failure that knows how to be tried again (a chunk that did not
    // arrive) is told first, so the render below asks again.
    const { error } = this.state;
    if (error instanceof RetryableError) error.retry();
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error && this.state.updating)
      return <ViewError title="kb was updated" message="Loading the new version…" />;
    if (this.state.error) {
      const { fallback } = this.props;
      if (fallback !== undefined && fallback !== null) return fallback;
      return (
        <ViewError
          title={this.props.title}
          message={this.state.error.message || undefined}
          onRetry={this.retry}
        />
      );
    }
    return this.props.children;
  }
}
