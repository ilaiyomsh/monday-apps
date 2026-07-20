import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { Logger } from '../types';

interface Props {
  logger: Logger;
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}
interface State {
  hasError: boolean;
}

/** Catches render-time throws (standard #6). Place outside all providers. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // fix 4: put componentStack into the ERROR record's context so the Axiom sink ships it
    // (as `component_stack`). The old separate DEBUG record never shipped, so it is removed —
    // the componentStack now rides the single ERROR record that already ships.
    this.props.logger.error('ErrorBoundary', error.message, error, { componentStack: info.componentStack });
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <div style={{ padding: 24, textAlign: 'center' }}>Something went wrong.</div>;
    }
    return this.props.children;
  }
}
