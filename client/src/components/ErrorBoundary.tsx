import { Component, type ReactNode } from "react";
import { reportClientError } from "@/lib/errorReport";

/** A crash in one page shows a way back instead of a blank screen, and lands in the admin error log. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportClientError(error?.message || String(error), `${error?.stack || ""}\n${info?.componentStack || ""}`.slice(0, 3000), "render");
  }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-sm rounded-2xl border border-card-border bg-card p-6 text-center" data-testid="box-crash">
        <p className="font-semibold">Something went wrong on this page</p>
        <p className="mt-1 text-sm text-muted-foreground">We've been told about it. Reload to try again, or head back to search.</p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={() => location.reload()} className="h-10 rounded-full taxi-sign px-4 text-sm font-semibold hover-elevate" data-testid="button-crash-reload">Reload</button>
          <a href="#/" className="inline-flex h-10 items-center rounded-full border border-border px-4 text-sm font-semibold hover-elevate">Search</a>
        </div>
      </div>
    );
  }
}
