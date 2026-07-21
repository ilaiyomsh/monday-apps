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
    //
    // The message is a CONSTANT event id ('render_error'), NOT error.message: the sink ships
    // `message` verbatim (only `err_msg` is scrubbed via scrubMessage), so folding a raw
    // error.message in here would leak PII past the privacy scrub (D2). The error instance
    // still travels as the payload, so the scrubbed err_msg / err_name / stack all ship; and
    // fix-5's dedup key already includes err_name + err_msg, so distinct errors stay distinct.
    this.props.logger.error('ErrorBoundary', 'render_error', error, { componentStack: info.componentStack });
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <div style={{ padding: 24, textAlign: 'center' }}>Something went wrong.</div>;
    }
    return this.props.children;
  }
}
