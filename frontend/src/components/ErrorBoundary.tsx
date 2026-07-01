import { Component, ErrorInfo, ReactNode } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

interface Props {
  children: ReactNode;
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/runtime errors in its subtree and shows a recoverable fallback
 * instead of letting a single component crash white-screen the whole SPA.
 *
 * Wrap the app once at the root, and again (keyed by route) around page content
 * so navigating away clears a crashed screen.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the component stack in the console for debugging. A real
    // deployment would forward this to an error-reporting service.
    console.error("Uncaught render error:", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md w-full text-center bg-white rounded-xl shadow-sm border border-gray-100 p-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <ExclamationTriangleIcon className="h-6 w-6 text-red-500" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">
            Something went wrong
          </h1>
          <p className="mt-1.5 text-sm text-gray-500">
            An unexpected error occurred while rendering this page. You can try
            again or head back to the dashboard.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-gray-50 p-3 text-left text-xs text-gray-600">
            {error.message}
          </pre>
          <div className="mt-5 flex justify-center gap-3">
            <button
              onClick={this.reset}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => {
                window.location.href = "/dashboard";
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
