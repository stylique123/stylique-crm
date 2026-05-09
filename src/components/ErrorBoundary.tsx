/**
 * ErrorBoundary — catches render errors inside leadership/onboarding routes
 * so a single broken selector cannot blank the whole app.
 *
 * Logs to console with route + error context. Renders an inline fallback
 * with a Reload button that resets the boundary.
 */
import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  routeName?: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Brutally specific log — route name + error + first 6 stack frames
    // eslint-disable-next-line no-console
    console.error(
      `[ErrorBoundary] Route "${this.props.routeName ?? 'unknown'}" crashed:`,
      {
        message: error.message,
        stack: error.stack?.split('\n').slice(0, 8).join('\n'),
        componentStack: info.componentStack?.split('\n').slice(0, 6).join('\n'),
      },
    );
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold">Something went wrong on this page</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {this.state.error?.message || 'An unexpected error occurred.'}
              </p>
              <p className="text-[11px] text-muted-foreground/70 mt-2">
                Route: <code className="font-mono">{this.props.routeName ?? 'unknown'}</code>
              </p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={this.reset}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Try again
                </Button>
                <Button size="sm" variant="ghost" onClick={() => window.location.assign('/')}>
                  Go home
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
