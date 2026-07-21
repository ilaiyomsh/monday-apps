import { Component, type ErrorInfo, type ReactNode } from 'react';
import logger from '../../lib/logger';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Stable English event id as the message (ships as-is); the Error rides record.error
    // (scrubbed to err_msg by the sink) and React's componentStack ships as component_stack.
    logger.error('admin', 'render_error', error, { componentStack: info.componentStack ?? undefined });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
          <h2 style={{ color: '#d83a52', margin: '0 0 8px 0' }}>Something went wrong</h2>
          <p style={{ color: '#676879', fontSize: 13 }}>
            {this.state.error.message}
          </p>
          <button
            style={{
              marginTop: 12,
              padding: '8px 14px',
              background: '#0073ea',
              color: '#fff',
              border: 0,
              borderRadius: 6,
              cursor: 'pointer',
            }}
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
